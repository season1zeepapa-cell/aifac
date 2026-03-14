import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';


    function KnowledgeGraphView({ documentId, docTitle }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [building, setBuilding] = useState(false);
      const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'list' | 'entities' | 'compare' | 'traverse'
      const [searchQuery, setSearchQuery] = useState('');
      const [typeFilter, setTypeFilter] = useState('all');
      const [hoveredNode, setHoveredNode] = useState(null);
      const [neo4jStatus, setNeo4jStatus] = useState(null); // { connected, message }
      const [compareData, setCompareData] = useState(null); // PG vs Neo4j 비교 결과
      const [comparing, setComparing] = useState(false);
      const [pathQuery, setPathQuery] = useState({ from: '', to: '' });
      const [pathResult, setPathResult] = useState(null);
      const [useLLMNer, setUseLLMNer] = useState(false); // LLM NER 하이브리드 모드
      const svgRef = useRef(null);
      const graphContainerRef = useRef(null);

      // BFS/DFS 탐색 상태
      const [traverseAlgo, setTraverseAlgo] = useState('bfs'); // 'bfs' | 'dfs'
      const [traverseHops, setTraverseHops] = useState(3);
      const [traverseStartId, setTraverseStartId] = useState('');
      const [traverseResult, setTraverseResult] = useState(null);
      const [traverseLoading, setTraverseLoading] = useState(false);
      const [highlightedChain, setHighlightedChain] = useState(null); // DFS 선택된 체인 인덱스
      const traverseSvgRef = useRef(null);
      const traverseContainerRef = useRef(null);

      // 엔티티 타입별 색상
      const typeColorMap = {
        law: { bg: 'bg-blue-100', text: 'text-blue-700', hex: '#3B82F6' },
        article: { bg: 'bg-green-100', text: 'text-green-700', hex: '#10B981' },
        organization: { bg: 'bg-amber-100', text: 'text-amber-700', hex: '#F59E0B' },
        concept: { bg: 'bg-purple-100', text: 'text-purple-700', hex: '#8B5CF6' },
        duty: { bg: 'bg-red-100', text: 'text-red-700', hex: '#EF4444' },
      };
      const typeLabels = {
        law: '법령', article: '조문', organization: '기관',
        concept: '개념', duty: '의무·권리',
      };

      // 관계(predicate)별 색상
      const predColorMap = {
        '준용': '#F59E0B', '적용': '#10B981', '예외': '#EF4444',
        '의거': '#6366F1', '위반': '#DC2626', '정의': '#3B82F6',
        '위임': '#8B5CF6', '관할': '#14B8A6', '소속': '#F97316',
        '근거': '#0EA5E9', '제한': '#E11D48', '부과': '#D946EF',
        '보호': '#22C55E', '고지': '#64748B',
      };

      // PG 데이터 로드
      const loadData = async () => {
        try {
          setLoading(true);
          const resp = await authFetch(`${API_BASE_URL}/knowledge-graph?docId=${documentId}`);
          const res = await resp.json();
          setData(res);
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };

      // Neo4j 연결 상태 확인
      const checkNeo4j = async () => {
        try {
          const resp = await authFetch(`${API_BASE_URL}/knowledge-graph-neo4j?status=true`);
          const res = await resp.json();
          setNeo4jStatus(res);
        } catch {
          setNeo4jStatus({ connected: false, message: 'API 호출 실패' });
        }
      };

      useEffect(() => { loadData(); checkNeo4j(); }, [documentId]);

      // PG 트리플 구축 (정규식 전용 or 하이브리드)
      const handleBuild = async () => {
        try {
          setBuilding(true);
          await authFetch(`${API_BASE_URL}/knowledge-graph`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: documentId, useLLM: useLLMNer }),
          });
          await loadData();
        } catch (e) {
          setError(e.message);
        } finally {
          setBuilding(false);
        }
      };

      // 증분 업데이트 (변경된 섹션만 처리)
      const [incrementalUpdating, setIncrementalUpdating] = useState(false);
      const [incrementalResult, setIncrementalResult] = useState(null);
      const handleIncrementalUpdate = async () => {
        try {
          setIncrementalUpdating(true);
          setIncrementalResult(null);
          const resp = await authFetch(`${API_BASE_URL}/knowledge-graph`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: documentId, useLLM: useLLMNer, incremental: true }),
          });
          const res = await resp.json();
          setIncrementalResult(res.stats);
          await loadData();
        } catch (e) {
          setError(e.message);
        } finally {
          setIncrementalUpdating(false);
        }
      };

      // PG vs Neo4j 비교 구축
      const handleCompare = async () => {
        try {
          setComparing(true);
          setCompareData(null);
          const resp = await authFetch(`${API_BASE_URL}/knowledge-graph-neo4j`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: documentId, compare: true }),
          });
          const res = await resp.json();
          setCompareData(res.comparison);
          // PG 데이터도 갱신
          await loadData();
        } catch (e) {
          setError(e.message);
        } finally {
          setComparing(false);
        }
      };

      // Neo4j 최단 경로 탐색
      const handlePathFind = async () => {
        if (!pathQuery.from || !pathQuery.to) return;
        try {
          const resp = await authFetch(`${API_BASE_URL}/knowledge-graph-neo4j`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              docId: documentId,
              path: true,
              from: pathQuery.from,
              to: pathQuery.to,
            }),
          });
          const res = await resp.json();
          setPathResult(res);
        } catch (e) {
          setPathResult({ found: false, error: e.message });
        }
      };

      // D3.js 그래프 렌더링
      useEffect(() => {
        if (viewMode !== 'graph' || !data || !data.nodes?.length || !svgRef.current) return;

        const container = graphContainerRef.current;
        const width = container?.clientWidth || 600;
        const height = 450;

        const svgEl = d3.select(svgRef.current);
        svgEl.selectAll('*').remove();
        svgEl.attr('viewBox', `0 0 ${width} ${height}`);

        const nodes = data.nodes.map(n => ({ ...n }));
        const links = data.links.map(l => ({
          ...l,
          source: typeof l.source === 'object' ? l.source.id : l.source,
          target: typeof l.target === 'object' ? l.target.id : l.target,
        }));

        const svg = svgEl;
        const g = svg.append('g');
        const zoom = d3.zoom()
          .scaleExtent([0.3, 4])
          .on('zoom', (event) => g.attr('transform', event.transform));
        svg.call(zoom);

        const defs = svg.append('defs');
        Object.entries(predColorMap).forEach(([pred, color]) => {
          defs.append('marker')
            .attr('id', `kg-arrow-${pred}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20).attr('refY', 0)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', color);
        });

        const radiusScale = d3.scaleSqrt()
          .domain([0, d3.max(nodes, d => d.linkCount) || 1])
          .range([8, 22]);

        const simulation = d3.forceSimulation(nodes)
          .force('link', d3.forceLink(links).id(d => d.id).distance(100))
          .force('charge', d3.forceManyBody().strength(-300))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(d => radiusScale(d.linkCount) + 10));

        const link = g.append('g')
          .selectAll('line').data(links).enter().append('line')
          .attr('stroke', d => predColorMap[d.predicate] || '#6B7280')
          .attr('stroke-opacity', 0.5)
          .attr('stroke-width', d => d.confidence >= 0.9 ? 2 : 1)
          .attr('marker-end', d => `url(#kg-arrow-${d.predicate})`);

        const linkLabel = g.append('g')
          .selectAll('text').data(links).enter().append('text')
          .attr('text-anchor', 'middle')
          .attr('fill', d => predColorMap[d.predicate] || '#6B7280')
          .attr('font-size', '8px').attr('dy', -4)
          .text(d => d.predicate);

        const node = g.append('g')
          .selectAll('g').data(nodes).enter().append('g')
          .style('cursor', 'pointer')
          .on('mouseover', (event, d) => setHoveredNode(d))
          .on('mouseout', () => setHoveredNode(null))
          .call(d3.drag()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null; d.fy = null;
            })
          );

        node.append('circle')
          .attr('r', d => radiusScale(d.linkCount))
          .attr('fill', d => typeColorMap[d.type]?.hex || '#6B7280')
          .attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', 0.9);

        node.append('text')
          .attr('dy', d => radiusScale(d.linkCount) + 12)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--text)').attr('font-size', '9px')
          .text(d => d.name.length > 10 ? d.name.substring(0, 10) + '…' : d.name);

        simulation.on('tick', () => {
          link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
          linkLabel.attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2);
          node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        return () => simulation.stop();
      }, [data, viewMode]);

      // BFS/DFS 탐색 결과 D3 그래프 렌더링
      useEffect(() => {
        if (viewMode !== 'traverse' || !traverseResult || !traverseResult.nodes?.length || !traverseSvgRef.current) return;

        const container = traverseContainerRef.current;
        const width = container?.clientWidth || 600;
        const height = 400;

        const svgEl = d3.select(traverseSvgRef.current);
        svgEl.selectAll('*').remove();
        svgEl.attr('viewBox', `0 0 ${width} ${height}`);

        // 노드/엣지 복사
        const nodes = traverseResult.nodes.map(n => ({ ...n }));
        const edges = (traverseResult.edges || []).map(e => ({
          ...e,
          source: e.sourceId || e.source,
          target: e.targetId || e.target,
        }));

        // 노드 ID → 이름 매핑 (하이라이트용)
        const nodeMap = {};
        nodes.forEach(n => { nodeMap[n.id] = n; });

        // 하이라이트할 노드/엣지 ID 세트
        const hlNodeIds = new Set();
        const hlEdgePairs = new Set();
        if (highlightedChain !== null && traverseResult.chains?.[highlightedChain]) {
          const chain = traverseResult.chains[highlightedChain];
          chain.path.forEach(p => hlNodeIds.add(p.id));
          for (let i = 0; i < chain.path.length - 1; i++) {
            hlEdgePairs.add(`${chain.path[i].id}-${chain.path[i+1].id}`);
            hlEdgePairs.add(`${chain.path[i+1].id}-${chain.path[i].id}`);
          }
        }
        const hasHighlight = hlNodeIds.size > 0;

        const svg = svgEl;
        const g = svg.append('g');
        const zoom = d3.zoom()
          .scaleExtent([0.3, 4])
          .on('zoom', (event) => g.attr('transform', event.transform));
        svg.call(zoom);

        // 화살표 마커
        const defs = svg.append('defs');
        Object.entries(predColorMap).forEach(([pred, color]) => {
          defs.append('marker')
            .attr('id', `tr-arrow-${pred}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20).attr('refY', 0)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', color);
        });
        // 하이라이트용 마커
        defs.append('marker')
          .attr('id', 'tr-arrow-hl')
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 20).attr('refY', 0)
          .attr('markerWidth', 7).attr('markerHeight', 7)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', '#F59E0B');

        // 깊이별 반지름
        const maxLink = d3.max(nodes, d => d.linkCount || d.depth || 1) || 1;
        const radiusScale = d3.scaleSqrt().domain([0, maxLink]).range([10, 24]);

        const simulation = d3.forceSimulation(nodes)
          .force('link', d3.forceLink(edges).id(d => d.id).distance(110))
          .force('charge', d3.forceManyBody().strength(-350))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(d => radiusScale(d.linkCount || d.depth || 1) + 12));

        // 엣지 렌더링
        const link = g.append('g')
          .selectAll('line').data(edges).enter().append('line')
          .attr('stroke', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            if (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) return '#F59E0B';
            return predColorMap[d.predicate] || '#6B7280';
          })
          .attr('stroke-opacity', d => {
            if (!hasHighlight) return 0.6;
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            return hlEdgePairs.has(`${sid}-${tid}`) ? 1 : 0.15;
          })
          .attr('stroke-width', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            if (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) return 3;
            return d.confidence >= 0.9 ? 2 : 1;
          })
          .attr('marker-end', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            if (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) return 'url(#tr-arrow-hl)';
            return `url(#tr-arrow-${d.predicate})`;
          });

        // 엣지 라벨
        const linkLabel = g.append('g')
          .selectAll('text').data(edges).enter().append('text')
          .attr('text-anchor', 'middle')
          .attr('fill', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            if (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) return '#F59E0B';
            if (hasHighlight) return '#CBD5E1';
            return predColorMap[d.predicate] || '#6B7280';
          })
          .attr('font-size', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            return (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) ? '10px' : '8px';
          })
          .attr('font-weight', d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            return (hasHighlight && hlEdgePairs.has(`${sid}-${tid}`)) ? 'bold' : 'normal';
          })
          .attr('dy', -5)
          .text(d => d.predicate);

        // 노드 렌더링
        const node = g.append('g')
          .selectAll('g').data(nodes).enter().append('g')
          .style('cursor', 'pointer')
          .call(d3.drag()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null; d.fy = null;
            })
          );

        // 노드 원
        node.append('circle')
          .attr('r', d => radiusScale(d.linkCount || d.depth || 1))
          .attr('fill', d => {
            if (hasHighlight && !hlNodeIds.has(d.id)) return '#D1D5DB';
            return typeColorMap[d.type]?.hex || '#6B7280';
          })
          .attr('stroke', d => {
            if (hasHighlight && hlNodeIds.has(d.id)) return '#F59E0B';
            return '#fff';
          })
          .attr('stroke-width', d => (hasHighlight && hlNodeIds.has(d.id)) ? 3 : 1.5)
          .attr('opacity', d => {
            if (!hasHighlight) return 0.9;
            return hlNodeIds.has(d.id) ? 1 : 0.3;
          });

        // 깊이 뱃지 (시작점 = 0)
        node.filter(d => d.depth === 0).append('text')
          .attr('text-anchor', 'middle').attr('dy', 4)
          .attr('fill', '#fff').attr('font-size', '9px').attr('font-weight', 'bold')
          .text('S');

        // 노드 라벨
        node.append('text')
          .attr('dy', d => radiusScale(d.linkCount || d.depth || 1) + 13)
          .attr('text-anchor', 'middle')
          .attr('fill', d => {
            if (hasHighlight && !hlNodeIds.has(d.id)) return '#94A3B8';
            return 'var(--text)';
          })
          .attr('font-size', d => (hasHighlight && hlNodeIds.has(d.id)) ? '10px' : '9px')
          .attr('font-weight', d => (hasHighlight && hlNodeIds.has(d.id)) ? 'bold' : 'normal')
          .text(d => d.name.length > 12 ? d.name.substring(0, 12) + '…' : d.name);

        simulation.on('tick', () => {
          link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
          linkLabel.attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2);
          node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        return () => simulation.stop();
      }, [traverseResult, viewMode, highlightedChain]);

      // 필터링
      const filteredEntities = (data?.entities || []).filter(e => {
        if (typeFilter !== 'all' && e.entity_type !== typeFilter) return false;
        if (searchQuery && !e.name.includes(searchQuery)) return false;
        return true;
      });
      const filteredTriples = (data?.links || []).filter(l => {
        if (!searchQuery) return true;
        const subj = data.nodes?.find(n => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        const obj = data.nodes?.find(n => n.id === (typeof l.target === 'object' ? l.target.id : l.target));
        return (subj?.name || '').includes(searchQuery) || (obj?.name || '').includes(searchQuery) || l.predicate.includes(searchQuery);
      });

      // 비교 바 렌더링 헬퍼 (막대 그래프)
      const CompareBar = ({ label, pgVal, neo4jVal, unit, higherIsBetter }) => {
        const maxVal = Math.max(pgVal || 0, neo4jVal || 0, 1);
        const pgBetter = higherIsBetter ? pgVal >= neo4jVal : pgVal <= neo4jVal;
        return createElement('div', { className: 'space-y-1' },
          createElement('p', { className: 'text-[10px] text-text-secondary font-medium' }, label),
          createElement('div', { className: 'flex items-center gap-2' },
            createElement('span', { className: 'text-[10px] w-8 text-right font-mono text-blue-600' }, 'PG'),
            createElement('div', { className: 'flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden' },
              createElement('div', {
                className: `h-full rounded-full transition-all ${pgBetter ? 'bg-blue-500' : 'bg-blue-300'}`,
                style: { width: `${(pgVal / maxVal) * 100}%` },
              }),
              createElement('span', { className: 'absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow' },
                `${pgVal}${unit}`),
            ),
          ),
          createElement('div', { className: 'flex items-center gap-2' },
            createElement('span', { className: 'text-[10px] w-8 text-right font-mono text-emerald-600' }, 'N4j'),
            createElement('div', { className: 'flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden' },
              createElement('div', {
                className: `h-full rounded-full transition-all ${!pgBetter ? 'bg-emerald-500' : 'bg-emerald-300'}`,
                style: { width: `${(neo4jVal / maxVal) * 100}%` },
              }),
              createElement('span', { className: 'absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow' },
                neo4jVal !== undefined ? `${neo4jVal}${unit}` : 'N/A'),
            ),
          ),
        );
      };

      if (loading) return createElement('div', { className: 'flex justify-center py-8' },
        createElement('div', { className: 'animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full' })
      );
      if (error) return createElement('div', { className: 'text-center py-8 text-red-500 text-sm' }, error);

      const stats = data?.stats || {};

      return createElement('div', { className: 'space-y-4 p-2' },
        // ─── 헤더 + 버튼 ───
        createElement('div', { className: 'flex items-center justify-between' },
          createElement('div', null,
            createElement('h3', { className: 'text-sm font-semibold text-text' }, '지식 그래프 (트리플스토어)'),
            createElement('p', { className: 'text-xs text-text-secondary mt-0.5' },
              `엔티티 ${stats.entities || 0}개 / 트리플 ${stats.triples || 0}개`
            ),
          ),
          createElement('div', { className: 'flex items-center gap-1' },
            // LLM NER 토글
            createElement('label', {
              className: 'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] cursor-pointer ' +
                (useLLMNer ? 'bg-yellow-500/20 text-yellow-400' : 'bg-border/50 text-text-secondary'),
              title: 'LLM Few-shot NER: 정규식이 놓치는 엔티티를 LLM이 보완합니다 (느리지만 정밀)',
            },
              createElement('input', {
                type: 'checkbox',
                checked: useLLMNer,
                onChange: (e) => setUseLLMNer(e.target.checked),
                className: 'w-3 h-3 accent-yellow-500',
              }),
              'LLM NER',
            ),
            createElement('button', {
              onClick: handleBuild,
              disabled: building || comparing,
              className: 'px-2.5 py-1.5 text-[11px] font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50',
            }, building ? (useLLMNer ? 'AI 분석중...' : '구축중...') : (useLLMNer ? 'Hybrid 구축' : 'PG 구축')),
            createElement('button', {
              onClick: handleIncrementalUpdate,
              disabled: building || comparing || incrementalUpdating,
              className: 'px-2.5 py-1.5 text-[11px] font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50',
              title: '변경된 섹션만 감지하여 그래프를 부분 갱신합니다 (전체 재구축보다 빠름)',
            }, incrementalUpdating ? '증분 갱신중...' : '증분 업데이트'),
            createElement('button', {
              onClick: handleCompare,
              disabled: building || comparing || !neo4jStatus?.connected,
              className: 'px-2.5 py-1.5 text-[11px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50',
              title: neo4jStatus?.connected ? 'PG와 Neo4j 동시 구축 비교' : neo4jStatus?.message || 'Neo4j 미연결',
            }, comparing ? '비교중...' : 'PG vs Neo4j'),
          ),
        ),

        // ─── Neo4j 연결 상태 표시 ───
        createElement('div', { className: `flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] ${
          neo4jStatus?.connected
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-gray-50 text-gray-500 border border-gray-200'
        }` },
          createElement('span', { className: `w-2 h-2 rounded-full ${neo4jStatus?.connected ? 'bg-emerald-500' : 'bg-gray-400'}` }),
          createElement('span', null, neo4jStatus?.connected ? 'Neo4j Aura 연결됨' : `Neo4j: ${neo4jStatus?.message || '확인 중...'}`),
        ),

        // ─── 증분 업데이트 결과 표시 ───
        incrementalResult && createElement('div', {
          className: `px-3 py-2 rounded-lg text-[11px] border ${
            incrementalResult.status === 'no_changes'
              ? 'bg-gray-50 text-gray-600 border-gray-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`,
        },
          incrementalResult.status === 'no_changes'
            ? createElement('span', null, '변경 사항 없음 — 모든 섹션이 최신 상태입니다')
            : createElement('span', null,
                `증분 완료: 추가 ${incrementalResult.added}건, 변경 ${incrementalResult.updated}건, `,
                `삭제 ${incrementalResult.removed}건, 유지 ${incrementalResult.unchanged}건 `,
                `(엔티티 ${incrementalResult.entities?.total || 0}, 트리플 ${incrementalResult.triples?.total || 0})`,
              ),
          createElement('button', {
            onClick: () => setIncrementalResult(null),
            className: 'ml-2 text-gray-400 hover:text-gray-600',
          }, '×'),
        ),

        // ─── 검색 + 타입 필터 ───
        createElement('div', { className: 'flex gap-2' },
          createElement('input', {
            type: 'text', placeholder: '엔티티 검색...', value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            className: 'flex-1 px-3 py-1.5 text-xs border border-border rounded-lg bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary',
          }),
          createElement('select', {
            value: typeFilter, onChange: (e) => setTypeFilter(e.target.value),
            className: 'px-2 py-1.5 text-xs border border-border rounded-lg bg-bg text-text',
          },
            createElement('option', { value: 'all' }, '전체'),
            ...Object.entries(typeLabels).map(([v, l]) =>
              createElement('option', { key: v, value: v }, l)
            ),
          ),
        ),

        // ─── 뷰 전환 토글 ───
        createElement('div', { className: 'flex gap-1 bg-card-bg border border-border rounded-lg p-0.5' },
          ...['graph', 'list', 'entities', 'traverse', 'compare'].map(mode =>
            createElement('button', {
              key: mode,
              onClick: () => setViewMode(mode),
              className: `flex-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                viewMode === mode ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
              }`,
            }, mode === 'graph' ? '그래프' : mode === 'list' ? '트리플' : mode === 'entities' ? '엔티티' : mode === 'traverse' ? '탐색' : 'PG vs Neo4j'),
          ),
        ),

        // ═══ 그래프 뷰 ═══
        viewMode === 'graph' && (data?.nodes?.length > 0
          ? createElement('div', { className: 'space-y-2' },
              createElement('div', {
                ref: graphContainerRef,
                className: 'border border-border rounded-lg overflow-hidden bg-bg relative',
              },
                createElement('svg', { ref: svgRef, className: 'w-full', style: { minHeight: '450px' } }),
                hoveredNode && createElement('div', {
                  className: 'absolute top-3 left-3 bg-card-bg border border-border rounded-lg p-3 shadow-lg max-w-xs z-10',
                },
                  createElement('div', { className: 'flex items-center gap-2' },
                    createElement('span', {
                      className: `text-[10px] px-1.5 py-0.5 rounded-full ${typeColorMap[hoveredNode.type]?.bg || 'bg-gray-100'} ${typeColorMap[hoveredNode.type]?.text || 'text-gray-700'}`,
                    }, typeLabels[hoveredNode.type] || hoveredNode.type),
                    createElement('span', { className: 'text-sm font-medium text-text' }, hoveredNode.name),
                  ),
                  createElement('p', { className: 'text-xs text-text-secondary mt-1' }, `연결 ${hoveredNode.linkCount}건`),
                ),
              ),
              createElement('div', { className: 'flex flex-wrap gap-3 px-1' },
                ...Object.entries(typeLabels).map(([type, label]) =>
                  createElement('div', { key: type, className: 'flex items-center gap-1' },
                    createElement('span', { className: 'w-3 h-3 rounded-full inline-block', style: { backgroundColor: typeColorMap[type]?.hex } }),
                    createElement('span', { className: 'text-[10px] text-text-secondary' }, label),
                  )
                ),
              ),
            )
          : createElement(EmptyState, { icon: '🔗', title: '지식 그래프가 없습니다', description: '"PG 구축" 버튼으로 엔티티와 관계를 추출하세요.' })
        ),

        // ═══ 트리플 목록 뷰 ═══
        viewMode === 'list' && (filteredTriples.length > 0
          ? createElement('div', { className: 'space-y-1.5 max-h-96 overflow-y-auto' },
              filteredTriples.map((triple, i) => {
                const subj = data.nodes?.find(n => n.id === (typeof triple.source === 'object' ? triple.source.id : triple.source));
                const obj = data.nodes?.find(n => n.id === (typeof triple.target === 'object' ? triple.target.id : triple.target));
                return createElement('div', { key: i, className: 'p-2.5 bg-card-bg border border-border rounded-lg hover:bg-card-bg-hover transition-colors' },
                  createElement('div', { className: 'flex items-center gap-1.5 flex-wrap text-xs' },
                    createElement('span', { className: `px-1.5 py-0.5 rounded-full ${typeColorMap[subj?.type]?.bg || 'bg-gray-100'} ${typeColorMap[subj?.type]?.text || 'text-gray-700'} font-medium` }, subj?.name || '?'),
                    createElement('span', { className: 'px-1.5 py-0.5 rounded font-bold text-white', style: { backgroundColor: predColorMap[triple.predicate] || '#6B7280', fontSize: '10px' } }, `→ ${triple.predicate} →`),
                    createElement('span', { className: `px-1.5 py-0.5 rounded-full ${typeColorMap[obj?.type]?.bg || 'bg-gray-100'} ${typeColorMap[obj?.type]?.text || 'text-gray-700'} font-medium` }, obj?.name || '?'),
                    createElement('span', { className: `text-[10px] px-1.5 py-0.5 rounded-full ml-auto ${triple.confidence >= 0.9 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}` }, `${(triple.confidence * 100).toFixed(0)}%`),
                  ),
                  triple.context && createElement('p', { className: 'text-[11px] text-text-secondary mt-1 leading-relaxed truncate' }, triple.context),
                );
              })
            )
          : createElement(EmptyState, { icon: '📊', title: '트리플이 없습니다', description: searchQuery ? '일치하는 트리플이 없습니다.' : '트리플을 구축해주세요.' })
        ),

        // ═══ 엔티티 목록 뷰 ═══
        viewMode === 'entities' && (filteredEntities.length > 0
          ? createElement('div', { className: 'space-y-1 max-h-96 overflow-y-auto' },
              filteredEntities.map((ent, i) =>
                createElement('div', { key: i, className: 'flex items-center gap-2 p-2 bg-card-bg border border-border rounded-lg hover:bg-card-bg-hover' },
                  createElement('span', { className: `text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${typeColorMap[ent.entity_type]?.bg || 'bg-gray-100'} ${typeColorMap[ent.entity_type]?.text || 'text-gray-700'}` }, typeLabels[ent.entity_type] || ent.entity_type),
                  createElement('span', { className: 'text-xs text-text font-medium truncate' }, ent.name),
                )
              )
            )
          : createElement(EmptyState, { icon: '🏷️', title: '엔티티가 없습니다', description: '트리플을 구축해주세요.' })
        ),

        // ═══ BFS/DFS 그래프 탐색 뷰 ═══
        viewMode === 'traverse' && createElement('div', { className: 'space-y-3' },
          // 탐색 설정 패널
          createElement('div', { className: 'bg-card-bg border border-border rounded-xl p-4 space-y-3' },
            createElement('div', { className: 'text-sm font-semibold text-text' }, '그래프 탐색 (BFS/DFS)'),
            createElement('p', { className: 'text-[11px] text-text-secondary' },
              'BFS: 시작점에서 물결처럼 퍼져나가며 탐색 (가까운 것부터) | DFS: 한 경로를 끝까지 추적 후 백트래킹 (연쇄 참조 발견)'),

            // 알고리즘 선택 + 홉 수
            createElement('div', { className: 'flex flex-wrap gap-2 items-center' },
              // BFS/DFS 토글
              createElement('div', { className: 'flex gap-1 bg-bg border border-border rounded-lg p-0.5' },
                ...['bfs', 'dfs'].map(algo =>
                  createElement('button', {
                    key: algo,
                    onClick: () => setTraverseAlgo(algo),
                    className: `px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                      traverseAlgo === algo
                        ? (algo === 'bfs' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white')
                        : 'text-text-secondary hover:text-text'
                    }`,
                  }, algo.toUpperCase()),
                ),
              ),

              // 홉 수 선택
              createElement('div', { className: 'flex items-center gap-1.5' },
                createElement('span', { className: 'text-[11px] text-text-secondary' }, '탐색 깊이:'),
                ...([1, 2, 3, 4, 5].map(h =>
                  createElement('button', {
                    key: h,
                    onClick: () => setTraverseHops(h),
                    className: `w-7 h-7 text-[11px] font-medium rounded-md transition-colors ${
                      traverseHops === h ? 'bg-primary text-white' : 'bg-bg border border-border text-text-secondary hover:text-text'
                    }`,
                  }, `${h}`)
                )),
              ),

              // 시작 엔티티 선택
              createElement('select', {
                value: traverseStartId,
                onChange: (e) => setTraverseStartId(e.target.value),
                className: 'flex-1 min-w-[180px] px-2.5 py-1.5 text-xs border border-border rounded-lg bg-bg text-text',
              },
                createElement('option', { value: '' }, '시작 엔티티 선택...'),
                ...(data?.entities || []).map(e =>
                  createElement('option', { key: e.id, value: e.id },
                    `[${typeLabels[e.entity_type] || e.entity_type}] ${e.name}`),
                ),
              ),

              // 탐색 실행 버튼
              createElement('button', {
                onClick: async () => {
                  if (!traverseStartId) return;
                  try {
                    setTraverseLoading(true);
                    setTraverseResult(null);
                    setHighlightedChain(null);
                    const params = new URLSearchParams({
                      traverse: traverseAlgo,
                      startId: traverseStartId,
                      hops: traverseHops.toString(),
                      docId: documentId.toString(),
                    });
                    const resp = await authFetch(`${API_BASE_URL}/knowledge-graph?${params}`);
                    const res = await resp.json();
                    setTraverseResult(res);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setTraverseLoading(false);
                  }
                },
                disabled: !traverseStartId || traverseLoading,
                className: `px-3 py-1.5 text-[11px] font-medium text-white rounded-lg disabled:opacity-50 ${
                  traverseAlgo === 'bfs' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-purple-500 hover:bg-purple-600'
                }`,
              }, traverseLoading ? '탐색중...' : `${traverseAlgo.toUpperCase()} 탐색`),
            ),
          ),

          // 탐색 결과
          traverseResult && createElement('div', { className: 'space-y-3' },
            // 통계 요약
            createElement('div', { className: 'flex flex-wrap gap-2' },
              createElement('span', { className: 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200' },
                `${traverseResult.algorithm?.toUpperCase()} | 시작: ${traverseResult.startEntity?.name}`),
              createElement('span', { className: 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200' },
                `노드 ${traverseResult.stats?.totalNodes}개`),
              createElement('span', { className: 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200' },
                `엣지 ${traverseResult.stats?.totalEdges}개`),
              createElement('span', { className: 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200' },
                `최대 깊이 ${traverseResult.stats?.maxDepth}홉`),
              traverseResult.stats?.totalChains && createElement('span', { className: 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200' },
                `연쇄 경로 ${traverseResult.stats.totalChains}개`),
            ),

            // BFS 결과: 깊이별 노드 목록
            traverseResult.algorithm === 'bfs' && traverseResult.nodes && createElement('div', { className: 'space-y-2' },
              // 깊이별로 그룹화
              ...Array.from(new Set(traverseResult.nodes.map(n => n.depth))).sort().map(depth =>
                createElement('div', { key: depth, className: 'bg-card-bg border border-border rounded-lg p-3' },
                  createElement('div', { className: 'text-[11px] font-semibold text-text-secondary mb-2' },
                    depth === 0 ? '시작점' : `${depth}홉 이웃`),
                  createElement('div', { className: 'flex flex-wrap gap-1.5' },
                    ...traverseResult.nodes.filter(n => n.depth === depth).map(n =>
                      createElement('span', {
                        key: n.id,
                        className: `px-2 py-1 rounded-full text-[11px] font-medium text-white cursor-pointer hover:opacity-80`,
                        style: { backgroundColor: typeColorMap[n.type] || '#6B7280' },
                        title: `${typeLabels[n.type] || n.type} | ID: ${n.id}`,
                        onClick: () => { setTraverseStartId(n.id.toString()); },
                      }, n.name),
                    ),
                  ),
                ),
              ),
            ),

            // DFS 결과: 연쇄 참조 체인 목록
            traverseResult.algorithm === 'dfs' && traverseResult.chains && createElement('div', { className: 'space-y-2' },
              createElement('div', { className: 'flex items-center gap-2 mb-1' },
                createElement('span', { className: 'text-xs font-semibold text-text' }, '발견된 연쇄 참조 경로'),
                highlightedChain !== null && createElement('button', {
                  onClick: () => setHighlightedChain(null),
                  className: 'px-2 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded-full hover:bg-amber-200',
                }, '하이라이트 해제'),
                createElement('span', { className: 'text-[10px] text-text-secondary' }, '(클릭하면 그래프에서 경로 강조)'),
              ),
              ...traverseResult.chains.slice(0, 30).map((chain, idx) =>
                createElement('div', {
                  key: idx,
                  onClick: () => setHighlightedChain(highlightedChain === idx ? null : idx),
                  className: `bg-card-bg border rounded-lg p-3 cursor-pointer transition-all ${
                    highlightedChain === idx
                      ? 'border-amber-400 ring-2 ring-amber-200 shadow-md'
                      : 'border-border hover:border-purple-300'
                  }`,
                },
                  // 깊이 + 신뢰도 뱃지
                  createElement('div', { className: 'flex items-center gap-2 mb-2' },
                    createElement('span', { className: 'px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-100 text-purple-700' },
                      `${chain.depth}홉`),
                    createElement('span', { className: 'px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 text-gray-600' },
                      `신뢰도: ${chain.confidence}`),
                    highlightedChain === idx && createElement('span', {
                      className: 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700',
                    }, '그래프에 표시 중'),
                  ),
                  // 경로 시각화: A →[관계]→ B →[관계]→ C
                  createElement('div', { className: 'flex flex-wrap items-center gap-1 text-[11px]' },
                    ...chain.path.flatMap((entity, i) => {
                      const items = [
                        createElement('span', {
                          key: `e${i}`,
                          className: 'px-2 py-0.5 rounded-full font-medium text-white',
                          style: { backgroundColor: highlightedChain === idx ? '#F59E0B' : (typeColorMap[entity.type]?.hex || '#6B7280') },
                        }, entity.name),
                      ];
                      if (i < chain.predicates.length) {
                        items.push(
                          createElement('span', {
                            key: `p${i}`,
                            className: 'text-text-secondary font-mono',
                          }, ` →[${chain.predicates[i]}]→ `),
                        );
                      }
                      return items;
                    }),
                  ),
                ),
              ),
              traverseResult.chains.length > 30 && createElement('div', { className: 'text-center text-[11px] text-text-secondary py-2' },
                `... 외 ${traverseResult.chains.length - 30}개 경로`),
            ),

            // D3 그래프 시각화 (탐색 결과)
            traverseResult.nodes?.length > 0 && createElement('div', {
              ref: traverseContainerRef,
              className: 'bg-card-bg border border-border rounded-xl overflow-hidden',
            },
              createElement('div', { className: 'px-3 py-2 border-b border-border flex items-center justify-between' },
                createElement('span', { className: 'text-[11px] font-semibold text-text' },
                  `${traverseResult.algorithm?.toUpperCase()} 그래프 시각화`),
                createElement('div', { className: 'flex items-center gap-2' },
                  highlightedChain !== null && createElement('span', {
                    className: 'text-[10px] text-amber-600 font-medium',
                  }, `경로 #${highlightedChain + 1} 강조 중`),
                  createElement('span', { className: 'text-[10px] text-text-secondary' }, '드래그: 이동 | 스크롤: 확대/축소'),
                ),
              ),
              createElement('svg', {
                ref: traverseSvgRef,
                className: 'w-full',
                style: { height: '400px', background: 'var(--bg)' },
              }),
            ),

            // 탐색 엣지 목록 (접혀 있음)
            traverseResult.edges?.length > 0 && createElement('details', { className: 'bg-card-bg border border-border rounded-lg' },
              createElement('summary', { className: 'px-3 py-2 text-[11px] font-medium text-text-secondary cursor-pointer hover:text-text' },
                `관계 상세 (${traverseResult.edges.length}건)`),
              createElement('div', { className: 'px-3 pb-3 space-y-1' },
                ...traverseResult.edges.slice(0, 50).map(edge =>
                  createElement('div', { key: edge.id, className: 'flex items-center gap-1 text-[11px]' },
                    createElement('span', { className: 'font-medium text-text' }, edge.sourceName),
                    createElement('span', { className: 'text-text-secondary' }, ` →[${edge.predicate}]→ `),
                    createElement('span', { className: 'font-medium text-text' }, edge.targetName),
                    createElement('span', { className: 'text-gray-400 ml-1' }, `(${edge.confidence})`),
                  ),
                ),
              ),
            ),
          ),
        ),

        // ═══ PG vs Neo4j 비교 뷰 ═══
        viewMode === 'compare' && createElement('div', { className: 'space-y-4' },
          // 비교 안내
          !compareData && !comparing && createElement('div', { className: 'text-center py-6 space-y-3' },
            createElement('p', { className: 'text-sm text-text-secondary' },
              neo4jStatus?.connected
                ? '상단 "PG vs Neo4j" 버튼을 클릭하면 동일 데이터로 양쪽을 구축하고 성능을 비교합니다.'
                : 'Neo4j가 연결되지 않았습니다. 환경변수(NEO4J_URI, NEO4J_PASSWORD)를 설정해주세요.'
            ),
            createElement('div', { className: 'text-xs text-text-secondary bg-card-bg border border-border rounded-lg p-3 text-left max-w-sm mx-auto' },
              createElement('p', { className: 'font-semibold mb-1' }, 'Neo4j Aura 무료 설정:'),
              createElement('p', null, '1. aura.neo4j.io 에서 무료 인스턴스 생성'),
              createElement('p', null, '2. .env 파일에 추가:'),
              createElement('code', { className: 'block bg-bg p-1.5 rounded mt-1 text-[10px]' },
                'NEO4J_URI=neo4j+s://xxx.databases.neo4j.io\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=your-password'
              ),
            ),
          ),

          // 비교 진행 중
          comparing && createElement('div', { className: 'flex flex-col items-center py-8 gap-3' },
            createElement('div', { className: 'animate-spin w-8 h-8 border-3 border-primary border-t-transparent rounded-full' }),
            createElement('p', { className: 'text-sm text-text-secondary' }, 'PG와 Neo4j 동시 구축 비교 중...'),
          ),

          // 비교 결과
          compareData && createElement('div', { className: 'space-y-4' },
            // 구축 성능 비교
            createElement('div', { className: 'bg-card-bg border border-border rounded-lg p-3' },
              createElement('h4', { className: 'text-xs font-semibold text-text mb-3' }, '구축 성능 비교'),
              createElement('div', { className: 'space-y-3' },
                createElement(CompareBar, {
                  label: '구축 시간',
                  pgVal: compareData.pg.build.timing || 0,
                  neo4jVal: compareData.neo4j.build.error ? 0 : (compareData.neo4j.build.timing || 0),
                  unit: 'ms', higherIsBetter: false,
                }),
                createElement(CompareBar, {
                  label: '엔티티 수',
                  pgVal: compareData.pg.build.entities?.total || 0,
                  neo4jVal: compareData.neo4j.build.error ? 0 : (compareData.neo4j.build.entities?.total || 0),
                  unit: '개', higherIsBetter: true,
                }),
                createElement(CompareBar, {
                  label: '트리플 수',
                  pgVal: compareData.pg.build.triples?.total || 0,
                  neo4jVal: compareData.neo4j.build.error ? 0 : (compareData.neo4j.build.triples?.total || 0),
                  unit: '개', higherIsBetter: true,
                }),
              ),
              compareData.neo4j.build.error && createElement('p', { className: 'text-[10px] text-red-500 mt-2' },
                `Neo4j 오류: ${compareData.neo4j.build.error}`
              ),
            ),

            // 조회 성능 비교
            createElement('div', { className: 'bg-card-bg border border-border rounded-lg p-3' },
              createElement('h4', { className: 'text-xs font-semibold text-text mb-3' }, '조회 성능 비교'),
              createElement('div', { className: 'space-y-3' },
                createElement(CompareBar, {
                  label: '조회 시간',
                  pgVal: compareData.pg.query.timing || 0,
                  neo4jVal: compareData.neo4j.query.timing || 0,
                  unit: 'ms', higherIsBetter: false,
                }),
                createElement(CompareBar, {
                  label: '그래프 노드 수',
                  pgVal: compareData.pg.query.entities || 0,
                  neo4jVal: compareData.neo4j.query.entities || 0,
                  unit: '개', higherIsBetter: true,
                }),
                createElement(CompareBar, {
                  label: '그래프 엣지 수',
                  pgVal: compareData.pg.query.triples || 0,
                  neo4jVal: compareData.neo4j.query.triples || 0,
                  unit: '개', higherIsBetter: true,
                }),
              ),
            ),

            // 기능 비교표
            createElement('div', { className: 'bg-card-bg border border-border rounded-lg p-3' },
              createElement('h4', { className: 'text-xs font-semibold text-text mb-2' }, '기능 비교'),
              createElement('table', { className: 'w-full text-[10px]' },
                createElement('thead', null,
                  createElement('tr', { className: 'border-b border-border' },
                    createElement('th', { className: 'text-left py-1 text-text-secondary font-medium' }, '기능'),
                    createElement('th', { className: 'text-center py-1 text-blue-600 font-medium' }, 'PostgreSQL'),
                    createElement('th', { className: 'text-center py-1 text-emerald-600 font-medium' }, 'Neo4j'),
                  ),
                ),
                createElement('tbody', null,
                  ...[
                    ['트리플 저장', 'JOIN 테이블', '네이티브 엣지'],
                    ['그래프 조회', 'SQL JOIN', 'Cypher 패턴 매칭'],
                    ['경로 탐색', '재귀 CTE (느림)', 'SHORTEST PATH (빠름)'],
                    ['N-hop 이웃', 'N중 JOIN', 'MATCH *1..N (자연스러움)'],
                    ['스키마', '고정 (마이그레이션)', '유연 (스키마리스)'],
                    ['트랜잭션', 'ACID (강함)', 'ACID (강함)'],
                    ['운영 비용', '기존 Supabase 활용', '별도 인스턴스 필요'],
                    ['Vercel 호환', '네이티브', 'TCP 연결 필요'],
                  ].map(([feature, pg, neo]) =>
                    createElement('tr', { key: feature, className: 'border-b border-border/50' },
                      createElement('td', { className: 'py-1.5 text-text font-medium' }, feature),
                      createElement('td', { className: 'py-1.5 text-center text-text-secondary' }, pg),
                      createElement('td', { className: 'py-1.5 text-center text-text-secondary' }, neo),
                    )
                  ),
                ),
              ),
            ),

            // Neo4j 전용: 최단 경로 탐색
            neo4jStatus?.connected && createElement('div', { className: 'bg-card-bg border border-emerald-200 rounded-lg p-3' },
              createElement('h4', { className: 'text-xs font-semibold text-emerald-700 mb-2' }, 'Neo4j 전용: 최단 경로 탐색'),
              createElement('p', { className: 'text-[10px] text-text-secondary mb-2' }, '두 엔티티 사이의 최단 관계 경로를 찾습니다 (그래프 DB의 강점)'),
              createElement('div', { className: 'flex gap-2 mb-2' },
                createElement('input', {
                  type: 'text', placeholder: '출발 엔티티 (예: 개인정보)',
                  value: pathQuery.from,
                  onChange: (e) => setPathQuery(p => ({ ...p, from: e.target.value })),
                  className: 'flex-1 px-2 py-1 text-xs border border-border rounded bg-bg text-text',
                }),
                createElement('span', { className: 'text-text-secondary self-center text-xs' }, '→'),
                createElement('input', {
                  type: 'text', placeholder: '도착 엔티티 (예: 파기)',
                  value: pathQuery.to,
                  onChange: (e) => setPathQuery(p => ({ ...p, to: e.target.value })),
                  className: 'flex-1 px-2 py-1 text-xs border border-border rounded bg-bg text-text',
                }),
                createElement('button', {
                  onClick: handlePathFind,
                  disabled: !pathQuery.from || !pathQuery.to,
                  className: 'px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50',
                }, '탐색'),
              ),
              // 경로 결과
              pathResult && (pathResult.found
                ? createElement('div', { className: 'bg-emerald-50 rounded p-2 space-y-1' },
                    createElement('p', { className: 'text-[10px] text-emerald-700 font-medium' },
                      `경로 발견! (길이: ${pathResult.length}, ${pathResult.timing}ms)`
                    ),
                    createElement('div', { className: 'flex items-center gap-1 flex-wrap' },
                      ...pathResult.path.flatMap((seg, i) => [
                        i === 0 && createElement('span', { key: `f-${i}`, className: 'px-1.5 py-0.5 bg-emerald-200 text-emerald-800 rounded text-[10px] font-medium' }, seg.from),
                        createElement('span', { key: `r-${i}`, className: 'text-[9px] text-emerald-600' }, `—[${seg.relation}]→`),
                        createElement('span', { key: `t-${i}`, className: 'px-1.5 py-0.5 bg-emerald-200 text-emerald-800 rounded text-[10px] font-medium' }, seg.to),
                      ].filter(Boolean)),
                    ),
                  )
                : createElement('p', { className: 'text-[10px] text-red-500' },
                    pathResult.error || `경로를 찾을 수 없습니다 (${pathResult.timing}ms)`)
              ),
            ),
          ),
        ),

        // ─── 통계 요약 ───
        viewMode !== 'compare' && stats.entities > 0 && createElement('div', { className: 'grid grid-cols-2 gap-2 text-[10px]' },
          createElement('div', { className: 'p-2 bg-card-bg border border-border rounded-lg' },
            createElement('p', { className: 'font-semibold text-text mb-1' }, '엔티티 타입'),
            ...Object.entries(stats.byType || {}).map(([type, count]) =>
              createElement('div', { key: type, className: 'flex justify-between text-text-secondary' },
                createElement('span', null, typeLabels[type] || type),
                createElement('span', { className: 'font-medium' }, count),
              )
            ),
          ),
          createElement('div', { className: 'p-2 bg-card-bg border border-border rounded-lg' },
            createElement('p', { className: 'font-semibold text-text mb-1' }, '관계 유형'),
            ...Object.entries(stats.byPredicate || {}).map(([pred, count]) =>
              createElement('div', { key: pred, className: 'flex justify-between text-text-secondary' },
                createElement('span', null, pred),
                createElement('span', { className: 'font-medium' }, count),
              )
            ),
          ),
        ),
      );
    }



export default KnowledgeGraphView;
