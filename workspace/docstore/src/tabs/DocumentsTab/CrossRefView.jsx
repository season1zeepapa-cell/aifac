import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { authFetch } from '../../lib/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';


    function CrossRefView({ documentId, docTitle }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [building, setBuilding] = useState(false);
      const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'list'
      const svgRef = useRef(null);
      const graphContainerRef = useRef(null);
      const [hoveredNode, setHoveredNode] = useState(null);

      // 교차 참조 데이터 로드
      const fetchCrossRefs = useCallback(async () => {
        setLoading(true);
        try {
          const resp = await authFetch(`/api/cross-references?docId=${documentId}`);
          if (!resp.ok) throw new Error('조회 실패');
          setData(await resp.json());
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }, [documentId]);

      useEffect(() => { fetchCrossRefs(); }, [fetchCrossRefs]);

      // 교차 참조 구축 트리거
      const handleBuild = useCallback(async (type) => {
        setBuilding(true);
        try {
          const resp = await authFetch('/api/cross-references', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: documentId, type }),
          });
          if (!resp.ok) throw new Error('구축 실패');
          const result = await resp.json();
          alert(`교차 참조 구축 완료!\n${JSON.stringify(result.results, null, 2)}`);
          fetchCrossRefs();
        } catch (e) {
          alert('교차 참조 구축 실패: ' + e.message);
        } finally {
          setBuilding(false);
        }
      }, [documentId, fetchCrossRefs]);

      // 관계 유형별 색상 (Badge용)
      const typeColors = {
        explicit: 'primary', '준용': 'yellow', '적용': 'green', '예외': 'red',
        '의거': 'blue', '위반': 'red', semantic: 'purple',
      };

      // 관계 유형별 링크 색상 (D3 그래프용)
      const linkColorMap = {
        explicit: '#3B82F6', '준용': '#F59E0B', '적용': '#10B981', '예외': '#EF4444',
        '의거': '#3B82F6', '위반': '#EF4444', semantic: '#8B5CF6',
      };

      // refs → D3 그래프 데이터 변환
      const graphData = useMemo(() => {
        const refs = data?.references || [];
        if (refs.length === 0) return null;

        // 고유 문서 노드 수집
        const docMap = new Map();
        // 현재 문서를 중심 노드로 추가
        docMap.set(documentId, { id: documentId, title: docTitle || `문서 ${documentId}`, isCurrent: true, refCount: 0 });

        refs.forEach(ref => {
          const srcId = ref.source_document_id;
          const tgtId = ref.target_document_id;
          if (!docMap.has(srcId)) {
            docMap.set(srcId, { id: srcId, title: ref.source_doc_title || `문서 ${srcId}`, isCurrent: false, refCount: 0 });
          }
          if (!docMap.has(tgtId)) {
            docMap.set(tgtId, { id: tgtId, title: ref.target_doc_title || `문서 ${tgtId}`, isCurrent: false, refCount: 0 });
          }
          docMap.get(srcId).refCount++;
          docMap.get(tgtId).refCount++;
        });

        // 문서 쌍별 참조 집계 (같은 소스→타겟 문서 간 여러 참조를 하나의 링크로)
        const linkKey = (s, t) => `${s}→${t}`;
        const linkMap = new Map();
        refs.forEach(ref => {
          const key = linkKey(ref.source_document_id, ref.target_document_id);
          if (!linkMap.has(key)) {
            linkMap.set(key, {
              source: ref.source_document_id,
              target: ref.target_document_id,
              count: 0,
              types: new Set(),
              avgConfidence: 0,
              totalConfidence: 0,
            });
          }
          const link = linkMap.get(key);
          link.count++;
          link.types.add(ref.relation_type);
          link.totalConfidence += ref.confidence || 0;
          link.avgConfidence = link.totalConfidence / link.count;
        });

        return {
          nodes: Array.from(docMap.values()),
          links: Array.from(linkMap.values()).map(l => ({
            ...l,
            types: Array.from(l.types),
          })),
        };
      }, [data, documentId, docTitle]);

      // D3 force 시뮬레이션 렌더링
      useEffect(() => {
        if (viewMode !== 'graph' || !graphData || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const container = graphContainerRef.current;
        const width = container?.clientWidth || 600;
        const height = 400;
        svg.attr('width', width).attr('height', height);

        // 줌/팬
        const g = svg.append('g');
        const zoom = d3.zoom()
          .scaleExtent([0.3, 4])
          .on('zoom', (event) => g.attr('transform', event.transform));
        svg.call(zoom);

        // 데이터 복사
        const nodes = graphData.nodes.map(n => ({ ...n }));
        const links = graphData.links.map(l => ({ ...l }));

        // 노드 크기: 참조 수에 비례
        const maxRef = d3.max(nodes, d => d.refCount) || 1;
        const radiusScale = d3.scaleLinear().domain([0, maxRef]).range([12, 30]);

        // force simulation
        const simulation = d3.forceSimulation(nodes)
          .force('link', d3.forceLink(links).id(d => d.id).distance(150))
          .force('charge', d3.forceManyBody().strength(-400))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(d => radiusScale(d.refCount) + 15));

        // 화살표 마커 (관계 유형별)
        const defs = svg.append('defs');
        Object.entries(linkColorMap).forEach(([type, color]) => {
          defs.append('marker')
            .attr('id', `crossref-arrow-${type.replace(/[^a-zA-Z]/g, '')}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('fill', color)
            .attr('d', 'M0,-5L10,0L0,5');
        });
        // 기본 화살표
        defs.append('marker')
          .attr('id', 'crossref-arrow-default')
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 25)
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('fill', '#9CA3AF')
          .attr('d', 'M0,-5L10,0L0,5');

        // 링크 렌더링
        const link = g.append('g')
          .selectAll('line')
          .data(links)
          .enter().append('line')
          .attr('stroke', d => linkColorMap[d.types[0]] || '#9CA3AF')
          .attr('stroke-opacity', 0.6)
          .attr('stroke-width', d => Math.min(d.count * 1.5, 6))
          .attr('marker-end', d => {
            const t = d.types[0]?.replace(/[^a-zA-Z]/g, '') || 'default';
            return `url(#crossref-arrow-${t})`;
          });

        // 링크 위 참조 수 라벨
        const linkLabel = g.append('g')
          .selectAll('text')
          .data(links.filter(l => l.count > 1))
          .enter().append('text')
          .text(d => `${d.count}건`)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', 'var(--text-secondary)')
          .attr('dy', -6);

        // 노드 그룹
        const node = g.append('g')
          .selectAll('g')
          .data(nodes)
          .enter().append('g')
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

        // 노드 원 — 현재 문서는 강조 색상
        node.append('circle')
          .attr('r', d => d.isCurrent ? 28 : radiusScale(d.refCount))
          .attr('fill', d => d.isCurrent ? '#3B82F6' : '#6B7280')
          .attr('stroke', d => d.isCurrent ? '#1D4ED8' : '#D1D5DB')
          .attr('stroke-width', d => d.isCurrent ? 3 : 1.5)
          .attr('opacity', 0.9);

        // 노드 라벨 (문서 제목, 줄바꿈)
        node.each(function(d) {
          const el = d3.select(this);
          const title = d.title || '';
          // 제목을 10자 이내로 잘라서 표시
          const maxLen = d.isCurrent ? 14 : 10;
          const lines = [];
          for (let i = 0; i < title.length; i += maxLen) {
            lines.push(title.substring(i, i + maxLen));
            if (lines.length >= 2) break;
          }
          if (title.length > maxLen * 2) lines[1] = lines[1].substring(0, maxLen - 1) + '…';

          lines.forEach((line, idx) => {
            el.append('text')
              .text(line)
              .attr('text-anchor', 'middle')
              .attr('dy', d.isCurrent
                ? (idx - (lines.length - 1) / 2) * 12
                : radiusScale(d.refCount) + 12 + idx * 11)
              .attr('font-size', d.isCurrent ? '10px' : '9px')
              .attr('font-weight', d.isCurrent ? '600' : '400')
              .attr('fill', d.isCurrent ? 'white' : 'var(--text-secondary)');
          });
        });

        // 호버 이벤트
        node.on('mouseover', function(event, d) {
          const connected = new Set();
          links.forEach(l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            if (sid === d.id) connected.add(tid);
            if (tid === d.id) connected.add(sid);
          });
          connected.add(d.id);

          node.select('circle').attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
          node.selectAll('text').attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
          link.attr('stroke-opacity', l => {
            const sid = typeof l.source === 'object' ? l.source.id : l.source;
            const tid = typeof l.target === 'object' ? l.target.id : l.target;
            return sid === d.id || tid === d.id ? 0.9 : 0.05;
          });

          setHoveredNode({
            title: d.title,
            isCurrent: d.isCurrent,
            refCount: d.refCount,
            // 이 노드와 연결된 참조 유형 수집
            types: [...new Set(links.filter(l => {
              const sid = typeof l.source === 'object' ? l.source.id : l.source;
              const tid = typeof l.target === 'object' ? l.target.id : l.target;
              return sid === d.id || tid === d.id;
            }).flatMap(l => l.types))],
          });
        })
        .on('mouseout', function() {
          node.select('circle').attr('opacity', 0.9);
          node.selectAll('text').attr('opacity', 1);
          link.attr('stroke-opacity', 0.6);
          setHoveredNode(null);
        });

        // tick 갱신
        simulation.on('tick', () => {
          link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
          linkLabel
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2);
          node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(0.85));

        return () => simulation.stop();
      }, [graphData, viewMode]);

      if (loading) return createElement('div', { className: 'flex justify-center py-8' },
        createElement('div', { className: 'animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full' })
      );

      if (error) return createElement('div', { className: 'text-center py-8 text-red-500 text-sm' }, error);

      const refs = data?.references || [];
      const stats = data?.stats || {};

      return createElement('div', { className: 'space-y-4 p-2' },
        // 헤더 + 구축 버튼
        createElement('div', { className: 'flex items-center justify-between' },
          createElement('div', null,
            createElement('h3', { className: 'text-sm font-semibold text-text' }, '문서 간 교차 참조'),
            createElement('p', { className: 'text-xs text-text-secondary mt-0.5' },
              `${stats.total || 0}건 (명시적 ${stats.explicit || 0} / 시맨틱 ${stats.semantic || 0})`
            ),
          ),
          createElement('div', { className: 'flex gap-1' },
            createElement('button', {
              onClick: () => handleBuild('explicit'),
              disabled: building,
              className: 'px-2 py-1 text-[10px] font-medium bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50',
            }, building ? '구축중...' : '명시적 구축'),
            createElement('button', {
              onClick: () => handleBuild('semantic'),
              disabled: building,
              className: 'px-2 py-1 text-[10px] font-medium bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50',
            }, building ? '구축중...' : '시맨틱 구축'),
          ),
        ),

        // 뷰 전환 토글 (그래프 / 목록)
        refs.length > 0 && createElement('div', { className: 'flex gap-1 bg-card-bg border border-border rounded-lg p-0.5' },
          createElement('button', {
            onClick: () => setViewMode('graph'),
            className: `flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'graph' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
            }`,
          }, '네트워크 그래프'),
          createElement('button', {
            onClick: () => setViewMode('list'),
            className: `flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'list' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
            }`,
          }, '참조 목록'),
        ),

        // 관련 문서 요약 (목록 모드에서만)
        viewMode === 'list' && stats.relatedDocs?.length > 0 && createElement('div', { className: 'flex flex-wrap gap-1' },
          stats.relatedDocs.map((title, i) =>
            createElement(Badge, { key: i, color: 'gray' }, title)
          )
        ),

        // ═══ 그래프 뷰 ═══
        viewMode === 'graph' && refs.length > 0 && graphData && createElement('div', { className: 'space-y-2' },
          // 그래프 컨테이너
          createElement('div', {
            ref: graphContainerRef,
            className: 'border border-border rounded-lg overflow-hidden bg-bg relative',
          },
            createElement('svg', {
              ref: svgRef,
              className: 'w-full',
              style: { minHeight: '400px' },
            }),
            // 호버 정보 패널
            hoveredNode && createElement('div', {
              className: 'absolute top-3 left-3 bg-card-bg border border-border rounded-lg p-3 shadow-lg max-w-xs z-10',
            },
              createElement('p', { className: 'text-sm font-medium text-text' },
                hoveredNode.isCurrent ? `📄 ${hoveredNode.title} (현재 문서)` : `📄 ${hoveredNode.title}`
              ),
              createElement('div', { className: 'flex gap-2 mt-1.5 text-xs text-text-secondary' },
                createElement('span', null, `참조 ${hoveredNode.refCount}건`),
              ),
              hoveredNode.types.length > 0 && createElement('div', { className: 'flex flex-wrap gap-1 mt-1.5' },
                hoveredNode.types.map((t, i) =>
                  createElement('span', {
                    key: i,
                    className: 'text-[10px] px-1.5 py-0.5 rounded-full',
                    style: { backgroundColor: linkColorMap[t] + '20', color: linkColorMap[t] || '#6B7280' },
                  }, t)
                )
              ),
            ),
          ),
          // 범례 (관계 유형별 색상)
          createElement('div', { className: 'flex flex-wrap gap-3 px-1' },
            [
              ['명시적', '#3B82F6'], ['준용', '#F59E0B'], ['적용', '#10B981'],
              ['예외', '#EF4444'], ['시맨틱', '#8B5CF6'],
            ].map(([label, color]) =>
              createElement('div', { key: label, className: 'flex items-center gap-1' },
                createElement('span', {
                  className: 'w-3 h-0.5 rounded-full inline-block',
                  style: { backgroundColor: color },
                }),
                createElement('span', { className: 'text-[10px] text-text-secondary' }, label),
              )
            ),
            createElement('div', { className: 'flex items-center gap-1' },
              createElement('span', { className: 'w-3 h-3 rounded-full bg-blue-500 inline-block border-2 border-blue-700' }),
              createElement('span', { className: 'text-[10px] text-text-secondary' }, '현재 문서'),
            ),
          ),
        ),

        // ═══ 목록 뷰 ═══
        viewMode === 'list' && (refs.length === 0
          ? createElement(EmptyState, {
              icon: '🔗',
              title: '교차 참조가 없습니다',
              description: '위 버튼을 클릭하여 다른 법령과의 참조 관계를 구축하세요.',
            })
          : createElement('div', { className: 'space-y-2 max-h-96 overflow-y-auto' },
              refs.map((ref, i) => {
                const isSource = ref.source_document_id === documentId;
                const otherDoc = isSource ? ref.target_doc_title : ref.source_doc_title;
                const sourceMeta = ref.source_meta || {};
                const targetMeta = ref.target_meta || {};
                const sourceLabel = sourceMeta.label || `섹션 ${ref.source_section_id}`;
                const targetLabel = targetMeta.label || `섹션 ${ref.target_section_id}`;

                return createElement('div', {
                  key: i,
                  className: 'p-3 bg-card-bg border border-border rounded-lg hover:bg-card-bg-hover transition-colors',
                },
                  createElement('div', { className: 'flex items-center gap-2 flex-wrap' },
                    createElement(Badge, { color: typeColors[ref.relation_type] || 'gray' }, ref.relation_type),
                    createElement('span', { className: 'text-xs font-medium text-text' },
                      isSource
                        ? `${sourceLabel} → ${otherDoc} ${targetLabel}`
                        : `${otherDoc} ${sourceLabel} → ${targetLabel}`
                    ),
                    createElement('span', { className: `text-[10px] px-1.5 py-0.5 rounded-full ${
                      ref.confidence >= 0.9 ? 'bg-green-100 text-green-700' :
                      ref.confidence >= 0.8 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }` }, `${(ref.confidence * 100).toFixed(0)}%`),
                  ),
                  ref.context && createElement('p', {
                    className: 'text-[11px] text-text-secondary mt-1 leading-relaxed',
                  }, ref.context),
                );
              })
            )),

        // 데이터 없음 (그래프 모드에서도 표시)
        viewMode === 'graph' && refs.length === 0 && createElement(EmptyState, {
          icon: '🔗',
          title: '교차 참조가 없습니다',
          description: '위 버튼을 클릭하여 다른 법령과의 참조 관계를 구축하세요.',
        }),
      );
    }



export default CrossRefView;
