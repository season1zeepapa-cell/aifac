import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Card from '../../components/ui/Card';


    function LawGraphView({ documentId, scrollToArticle }) {
      const svgRef = useRef(null);
      const containerRef = useRef(null);
      const [graphData, setGraphData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [hoveredNode, setHoveredNode] = useState(null);
      const [showStats, setShowStats] = useState(false);

      // 장(chapter)별 색상 팔레트
      const chapterColors = useMemo(() => {
        if (!graphData) return {};
        const chapters = [...new Set(graphData.nodes.map(n => n.chapter).filter(Boolean))];
        const palette = [
          '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
          '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1',
          '#D946EF', '#84CC16',
        ];
        const map = {};
        chapters.forEach((ch, i) => { map[ch] = palette[i % palette.length]; });
        return map;
      }, [graphData]);

      // 그래프 데이터 로드
      useEffect(() => {
        if (!documentId) return;
        setLoading(true);
        setError(null);
        authFetch(`${API_BASE_URL}/law-graph?docId=${documentId}`)
          .then(res => {
            if (!res.ok) throw new Error('그래프 데이터를 불러올 수 없습니다.');
            return res.json();
          })
          .then(setGraphData)
          .catch(err => setError(err.message))
          .finally(() => setLoading(false));
      }, [documentId]);

      // D3 force simulation 렌더링
      useEffect(() => {
        if (!graphData || !svgRef.current || graphData.nodes.length === 0) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const container = containerRef.current;
        const width = container?.clientWidth || 600;
        const height = 500;

        svg.attr('width', width).attr('height', height);

        // 줌/팬 설정
        const g = svg.append('g');
        const zoom = d3.zoom()
          .scaleExtent([0.3, 4])
          .on('zoom', (event) => g.attr('transform', event.transform));
        svg.call(zoom);

        // 노드/링크 데이터 복사 (D3가 데이터를 변형하므로)
        const nodes = graphData.nodes.map(n => ({ ...n }));
        const links = graphData.links.map(l => ({ ...l }));

        // 노드 크기: 역참조 수에 비례 (최소 5, 최대 20)
        const radiusScale = d3.scaleLinear()
          .domain([0, d3.max(nodes, d => d.refCount) || 1])
          .range([5, 20]);

        // force simulation
        const simulation = d3.forceSimulation(nodes)
          .force('link', d3.forceLink(links).id(d => d.id).distance(80))
          .force('charge', d3.forceManyBody().strength(-200))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(d => radiusScale(d.refCount) + 5));

        // 화살표 마커 정의
        svg.append('defs').selectAll('marker')
          .data(['arrow'])
          .enter().append('marker')
          .attr('id', 'arrow')
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 20)
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('fill', 'var(--text-secondary)')
          .attr('d', 'M0,-5L10,0L0,5');

        // 링크 (화살표)
        const link = g.append('g')
          .selectAll('line')
          .data(links)
          .enter().append('line')
          .attr('stroke', 'var(--text-secondary)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1)
          .attr('marker-end', 'url(#arrow)');

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

        // 노드 원
        node.append('circle')
          .attr('r', d => radiusScale(d.refCount))
          .attr('fill', d => chapterColors[d.chapter] || '#9CA3AF')
          .attr('stroke', 'white')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.85);

        // 노드 라벨 (큰 노드만)
        node.append('text')
          .text(d => d.refCount >= 2 ? d.id : '')
          .attr('text-anchor', 'middle')
          .attr('dy', d => radiusScale(d.refCount) + 12)
          .attr('font-size', '10px')
          .attr('fill', 'var(--text-secondary)');

        // 호버 이벤트
        node.on('mouseover', function(event, d) {
          // 연결된 노드 하이라이트
          const connected = new Set();
          links.forEach(l => {
            if (l.source.id === d.id) connected.add(l.target.id);
            if (l.target.id === d.id) connected.add(l.source.id);
          });
          connected.add(d.id);

          node.select('circle').attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
          node.select('text').attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
          link.attr('stroke-opacity', l =>
            l.source.id === d.id || l.target.id === d.id ? 0.8 : 0.05
          ).attr('stroke-width', l =>
            l.source.id === d.id || l.target.id === d.id ? 2 : 1
          );

          // 호버 정보 업데이트
          setHoveredNode(d);
        })
        .on('mouseout', function() {
          node.select('circle').attr('opacity', 0.85);
          node.select('text').attr('opacity', 1);
          link.attr('stroke-opacity', 0.3).attr('stroke-width', 1);
          setHoveredNode(null);
        })
        .on('click', function(event, d) {
          if (scrollToArticle) scrollToArticle(d.id);
        });

        // 매 tick마다 위치 갱신
        simulation.on('tick', () => {
          link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
          node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        // 초기 줌 맞추기 (약간 축소)
        svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(0.9));

        return () => simulation.stop();
      }, [graphData, chapterColors]);

      if (loading) {
        return (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        );
      }

      if (error) {
        return <p className="text-sm text-red-500 py-8 text-center">{error}</p>;
      }

      if (!graphData || graphData.nodes.length === 0) {
        return <p className="text-sm text-text-secondary py-8 text-center">참조 관계 데이터가 없습니다.</p>;
      }

      const stats = graphData.stats || {};

      return (
        <div className="space-y-3">
          {/* 그래프 영역 */}
          <div ref={containerRef} className="border border-border rounded-lg overflow-hidden bg-bg relative">
            <svg ref={svgRef} className="w-full" style={{ minHeight: '500px' }} />

            {/* 호버 정보 */}
            {hoveredNode && (
              <div className="absolute top-3 left-3 bg-card-bg border border-border rounded-lg p-3 shadow-lg max-w-xs">
                <p className="text-sm font-medium text-text">{hoveredNode.label}</p>
                {hoveredNode.chapter && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: chapterColors[hoveredNode.chapter] }} />
                    <span className="text-xs text-text-secondary">{hoveredNode.chapter}</span>
                  </div>
                )}
                <div className="flex gap-3 mt-1.5 text-xs text-text-secondary">
                  <span>역참조 {hoveredNode.refCount}건</span>
                  <span>참조 {hoveredNode.outCount}건</span>
                </div>
                <p className="text-[10px] text-text-secondary/60 mt-1">클릭하면 조문으로 이동</p>
              </div>
            )}
          </div>

          {/* 범례 (장별 색상) */}
          <div className="flex flex-wrap gap-2 px-1">
            {Object.entries(chapterColors).map(([ch, color]) => (
              <div key={ch} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-text-secondary">{ch}</span>
              </div>
            ))}
          </div>

          {/* 통계 패널 (토글) */}
          <button
            onClick={() => setShowStats(s => !s)}
            className="w-full text-left px-3 py-2 text-xs font-medium text-text-secondary bg-card-bg border border-border rounded-lg hover:bg-card-bg-hover transition-colors"
          >
            참조 통계 {showStats ? '접기' : '보기'} — {stats.totalNodes}개 조문, {stats.totalLinks}개 참조 관계
          </button>

          {showStats && (
            <Card className="border-border space-y-3">
              {/* 가장 많이 참조되는 조문 */}
              {stats.mostReferenced?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-1">가장 많이 참조되는 조문 (핵심 조문)</p>
                  <div className="space-y-1">
                    {stats.mostReferenced.filter(n => n.count > 0).map((n, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <button
                          onClick={() => scrollToArticle && scrollToArticle(n.id)}
                          className="text-xs text-primary hover:underline"
                        >{n.label}</button>
                        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${(n.count / (stats.mostReferenced[0]?.count || 1)) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-secondary w-8 text-right">{n.count}회</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 가장 많이 참조하는 조문 */}
              {stats.mostReferencing?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-1">가장 많이 참조하는 조문</p>
                  <div className="space-y-1">
                    {stats.mostReferencing.filter(n => n.count > 0).map((n, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <button
                          onClick={() => scrollToArticle && scrollToArticle(n.id)}
                          className="text-xs text-primary hover:underline"
                        >{n.label}</button>
                        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-yellow-500 rounded-full"
                            style={{ width: `${(n.count / (stats.mostReferencing[0]?.count || 1)) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-secondary w-8 text-right">{n.count}개</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 장별 참조 밀도 */}
              {stats.chapterDensity && Object.keys(stats.chapterDensity).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-1">장별 참조 밀도</p>
                  <div className="space-y-1">
                    {Object.entries(stats.chapterDensity)
                      .sort((a, b) => b[1].refs - a[1].refs)
                      .map(([ch, d]) => (
                        <div key={ch} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: chapterColors[ch] || '#9CA3AF' }} />
                          <span className="text-xs text-text-secondary w-24 truncate">{ch}</span>
                          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                backgroundColor: chapterColors[ch] || '#9CA3AF',
                                width: `${(d.refs / Math.max(...Object.values(stats.chapterDensity).map(v => v.refs), 1)) * 100}%`
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-text-secondary w-16 text-right">{d.count}조 / {d.refs}건</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 고립된 조문 */}
              {stats.isolatedCount > 0 && (
                <p className="text-xs text-text-secondary">
                  고립된 조문 (참조 관계 없음): {stats.isolatedCount}개
                </p>
              )}
            </Card>
          )}
        </div>
      );
    }



export default LawGraphView;
