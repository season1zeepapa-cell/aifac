import { createElement, useState } from 'react';
import { marked } from 'marked';


    function ParsedAnswer({ parsed, raw, sources, isStreaming }) {
      const [showEvidence, setShowEvidence] = useState(true);
      const [showCrossRefs, setShowCrossRefs] = useState(false);
      const [showRaw, setShowRaw] = useState(false);

      // 파싱 결과가 없거나 파싱 실패 시 기존 마크다운 렌더링
      if (!parsed || !parsed.parsed) {
        // 스트리밍 중 JSON 원문이면 "생성 중..." 표시
        const looksLikeJson = raw && raw.trimStart().startsWith('{');
        if (isStreaming && looksLikeJson) {
          return createElement('div', { className: 'text-sm text-text-secondary flex items-center gap-2' },
            createElement('div', { className: 'w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin' }),
            '답변 생성 중...'
          );
        }
        // 스트리밍 완료 후 JSON이면 본문 텍스트를 추출해서 표시
        if (looksLikeJson) {
          try {
            // 코드 블록 제거 + 불완전 JSON 복구 시도
            let jsonStr = raw.replace(/^```(?:json)?\s*\n?|\n?\s*```$/g, '').trim();
            // 닫는 중괄호 누락 시 추가
            const opens = (jsonStr.match(/\{/g) || []).length;
            const closes = (jsonStr.match(/\}/g) || []).length;
            if (opens > closes) jsonStr += '}'.repeat(opens - closes);
            // 마지막에 쉼표가 있으면 제거
            jsonStr = jsonStr.replace(/,\s*\}/g, '}');

            const obj = JSON.parse(jsonStr);
            // 다양한 키명 지원: conclusion, 결론, answer, summary, response 등
            const text = obj.conclusion || obj['결론'] || obj.answer || obj.summary
              || obj.response || obj['답변'] || obj['요약']
              // 위 키가 모두 없으면 모든 문자열 값을 합침
              || Object.values(obj).filter(v => typeof v === 'string' && v.length > 20).join('\n\n');

            if (text) {
              return createElement('div', {
                className: 'text-sm text-text leading-relaxed markdown-body break-words',
                dangerouslySetInnerHTML: {
                  __html: typeof marked !== 'undefined' ? marked.parse(text) : text
                }
              });
            }
          } catch {
            // JSON 파싱 완전 실패 시 → JSON 속 텍스트 부분만 정규식으로 추출
            const textMatch = raw.match(/"(?:conclusion|결론|answer|summary|response|답변)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (textMatch) {
              const extracted = textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
              return createElement('div', {
                className: 'text-sm text-text leading-relaxed markdown-body break-words',
                dangerouslySetInnerHTML: {
                  __html: typeof marked !== 'undefined' ? marked.parse(extracted) : extracted
                }
              });
            }
          }
        }
        // 일반 텍스트/마크다운 렌더링
        return createElement('div', {
          className: 'text-sm text-text leading-relaxed markdown-body break-words',
          dangerouslySetInnerHTML: {
            __html: typeof marked !== 'undefined' ? marked.parse(raw || '') : (raw || '')
          }
        });
      }

      const { conclusion, evidenceChain, crossReferences, caveats, warnings, format } = parsed;

      // 근거 검증 통계
      const verifiedCount = (evidenceChain || []).filter(s => s.verified !== false).length;
      const unverifiedCount = (evidenceChain || []).filter(s => s.verified === false).length;
      const totalSteps = (evidenceChain || []).length;
      const allVerified = totalSteps > 0 && unverifiedCount === 0;

      return createElement('div', { className: 'space-y-2' },
        // 환각 경고 배너 — 미검증 근거가 있을 때 눈에 띄게 표시
        unverifiedCount > 0 && createElement('div', {
          className: 'flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg'
        },
          // 경고 아이콘
          createElement('div', { className: 'flex-shrink-0 mt-0.5' },
            createElement('svg', {
              className: 'w-4 h-4 text-red-500', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
            }, createElement('path', {
              strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2,
              d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
            }))
          ),
          createElement('div', { className: 'flex-1 min-w-0' },
            createElement('p', { className: 'text-xs font-bold text-red-700 dark:text-red-400' },
              `AI 답변 신뢰도 주의 — ${unverifiedCount}건의 미검증 근거 발견`
            ),
            createElement('p', { className: 'text-[11px] text-red-600/80 dark:text-red-400/70 mt-0.5 leading-relaxed' },
              'AI가 인용한 근거 번호가 실제 검색된 자료에 존재하지 않습니다. 해당 부분은 AI가 생성한 내용(환각)일 수 있으므로, 반드시 원문을 직접 확인해주세요.'
            ),
          ),
        ),

        // 기존 경고 배지 (세부 경고 내용)
        warnings && warnings.length > 0 && createElement('div', {
          className: 'flex flex-wrap gap-1 mb-1'
        },
          warnings.map((w, i) => createElement('span', {
            key: i,
            className: 'text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
            title: 'AI가 인용한 근거 번호가 검색 결과 범위를 초과합니다'
          }, w))
        ),

        // 결론 섹션
        conclusion && createElement('div', {
          className: 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3'
        },
          createElement('div', { className: 'flex items-center gap-1.5 mb-1.5' },
            createElement('span', { className: 'text-blue-600 dark:text-blue-400 text-xs font-bold' }, '\u{1F4A1} 결론')
          ),
          createElement('div', {
            className: 'text-sm text-text leading-relaxed markdown-body break-words',
            dangerouslySetInnerHTML: {
              __html: typeof marked !== 'undefined' ? marked.parse(conclusion) : conclusion
            }
          })
        ),

        // 근거 체인 섹션
        evidenceChain && evidenceChain.length > 0 && createElement('div', {
          className: 'border border-border rounded-lg overflow-hidden'
        },
          createElement('button', {
            className: 'w-full flex items-center justify-between px-3 py-2 bg-bg hover:bg-card-bg transition-colors text-left',
            onClick: () => setShowEvidence(v => !v)
          },
            createElement('span', { className: 'text-xs font-bold text-text flex items-center gap-1.5' },
              '\u{1F4CB} 근거 체인',
              createElement('span', { className: 'text-text-secondary font-normal' }, `(${totalSteps}단계)`),
              // 신뢰도 요약 배지
              allVerified
                ? createElement('span', {
                    className: 'px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
                    title: '모든 근거가 검색된 자료에서 확인되었습니다'
                  }, `${verifiedCount}/${totalSteps} 검증됨`)
                : createElement('span', {
                    className: 'px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
                    title: `${unverifiedCount}건의 근거가 검색 결과에서 확인되지 않았습니다. AI 환각 가능성이 있습니다.`
                  }, `${verifiedCount}/${totalSteps} 검증됨`)
            ),
            createElement('svg', {
              className: `w-3.5 h-3.5 text-text-secondary transition-transform ${showEvidence ? 'rotate-180' : ''}`,
              fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
            }, createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' }))
          ),
          showEvidence && createElement('div', { className: 'px-3 pb-3 space-y-2 pt-1' },
            evidenceChain.map((step, i) => {
              const srcIdx = step.sourceIndex;
              const matchedSource = srcIdx && sources && sources[srcIdx - 1];
              // 검증 상태별 툴팁 메시지 생성
              const verifiedTooltip = step.verified === false
                ? `미검증: AI가 [근거 ${srcIdx || '?'}]을 인용했지만, 실제 검색된 ${sources?.length || 0}건의 자료에 해당 번호가 없습니다. 이 내용은 AI가 생성한 것(환각)일 수 있습니다.`
                : matchedSource
                  ? `검증됨: "${matchedSource.documentTitle}" 문서의 "${matchedSource.label || '해당 섹션'}"에서 확인된 근거입니다. (유사도: ${matchedSource.similarity ? (matchedSource.similarity * 100).toFixed(1) + '%' : '정보 없음'})`
                  : '검증됨: 검색 결과에서 확인된 근거입니다.';

              return createElement('div', {
                key: i,
                className: `relative pl-6 ${i < evidenceChain.length - 1 ? 'pb-2 border-l-2 border-blue-200 dark:border-blue-800 ml-1.5' : 'ml-1.5'}`
              },
                // 순서 번호 원형 — 툴팁 포함
                createElement('div', {
                  className: `absolute -left-[9px] top-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold cursor-help ${
                    step.verified !== false
                      ? 'bg-blue-500 text-white'
                      : 'bg-red-400 text-white animate-pulse'
                  }`,
                  title: verifiedTooltip
                }, step.step || i + 1),
                // 조문명 + 검증 배지
                createElement('div', { className: 'text-xs flex items-center flex-wrap gap-1' },
                  srcIdx && createElement('span', {
                    className: 'font-bold text-blue-600 dark:text-blue-400'
                  }, `[근거 ${srcIdx}]`),
                  createElement('span', {
                    className: 'font-medium text-text'
                  }, step.sourceLabel || ''),
                  // 검증 상태 배지 — 툴팁 포함
                  step.verified === false
                    ? createElement('span', {
                        className: 'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 cursor-help',
                        title: verifiedTooltip
                      },
                        createElement('svg', {
                          className: 'w-2.5 h-2.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                        }, createElement('path', {
                          strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.5,
                          d: 'M12 9v2m0 4h.01'
                        })),
                        '미검증 — 환각 가능'
                      )
                    : matchedSource && createElement('span', {
                        className: 'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 cursor-help',
                        title: verifiedTooltip
                      },
                        createElement('svg', {
                          className: 'w-2.5 h-2.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
                        }, createElement('path', {
                          strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.5,
                          d: 'M5 13l4 4L19 7'
                        })),
                        '검증됨'
                      )
                ),
                // 출처 정보 (검증된 근거일 때 문서명 + 유사도 표시)
                matchedSource && createElement('div', {
                  className: 'text-[10px] text-text-secondary/70 mt-0.5 flex items-center gap-1'
                },
                  createElement('span', null, `${matchedSource.documentTitle}`),
                  matchedSource.label && createElement('span', null, `· ${matchedSource.label}`),
                  matchedSource.similarity && createElement('span', {
                    className: matchedSource.similarity >= 0.8 ? 'text-green-600 dark:text-green-400 font-medium' :
                               matchedSource.similarity >= 0.6 ? 'text-yellow-600 dark:text-yellow-400' : 'text-text-secondary'
                  }, `· ${(matchedSource.similarity * 100).toFixed(1)}%`)
                ),
                // 인용
                step.quote && createElement('div', {
                  className: 'text-xs text-text-secondary mt-0.5 pl-2 border-l-2 border-gray-200 dark:border-gray-600 italic'
                }, `"${step.quote}"`),
                // 설명
                step.reasoning && createElement('div', {
                  className: 'text-xs text-text mt-0.5'
                }, `\u2192 ${step.reasoning}`),
                // 연결 화살표
                i < evidenceChain.length - 1 && createElement('div', {
                  className: 'text-[10px] text-blue-500 font-medium mt-1'
                }, '\u2193 따라서')
              );
            })
          )
        ),

        // 교차 참조 섹션
        crossReferences && crossReferences.length > 0 && createElement('div', {
          className: 'border border-border rounded-lg overflow-hidden'
        },
          createElement('button', {
            className: 'w-full flex items-center justify-between px-3 py-2 bg-bg hover:bg-card-bg transition-colors text-left',
            onClick: () => setShowCrossRefs(v => !v)
          },
            createElement('span', { className: 'text-xs font-bold text-text flex items-center gap-1' },
              '\u{1F517} \uAD50\uCC28 \uCC38\uC870',
              createElement('span', { className: 'text-text-secondary font-normal' }, `(${crossReferences.length}\uAC74)`)
            ),
            createElement('svg', {
              className: `w-3.5 h-3.5 text-text-secondary transition-transform ${showCrossRefs ? 'rotate-180' : ''}`,
              fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24'
            }, createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 9l-7 7-7-7' }))
          ),
          showCrossRefs && createElement('div', { className: 'px-3 pb-2 space-y-1 pt-1' },
            crossReferences.map((ref, i) => createElement('div', {
              key: i,
              className: 'flex items-center gap-1.5 text-xs'
            },
              createElement('span', { className: 'text-text font-medium' }, ref.from),
              createElement('span', { className: 'text-purple-500 font-bold' }, `\u2192 (${ref.relation}) \u2192`),
              createElement('span', { className: 'text-text font-medium' }, ref.to)
            ))
          )
        ),

        // 주의사항 섹션
        caveats && caveats.trim().length > 0 && createElement('div', {
          className: 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3'
        },
          createElement('div', { className: 'flex items-center gap-1 mb-1' },
            createElement('span', { className: 'text-amber-600 dark:text-amber-400 text-xs font-bold' }, '\u26A0\uFE0F \uC8FC\uC758\uC0AC\uD56D')
          ),
          createElement('div', {
            className: 'text-xs text-text leading-relaxed markdown-body',
            dangerouslySetInnerHTML: {
              __html: typeof marked !== 'undefined' ? marked.parse(caveats) : caveats
            }
          })
        ),

        // 원본 보기 토글 (디버그용)
        createElement('div', { className: 'flex items-center gap-2' },
          createElement('button', {
            className: 'text-[10px] text-text-secondary hover:text-text transition-colors',
            onClick: () => setShowRaw(v => !v)
          }, showRaw ? '\u25B2 \uC6D0\uBCF8 \uC811\uAE30' : `\u25BC \uC6D0\uBCF8 \uBCF4\uAE30 (${format})`),
        ),
        showRaw && createElement('div', {
          className: 'text-xs text-text-secondary bg-bg rounded p-2 border border-border max-h-60 overflow-y-auto markdown-body',
          dangerouslySetInnerHTML: {
            __html: typeof marked !== 'undefined' ? marked.parse(raw || '') : (raw || '')
          }
        })
      );
    }

    // ========================================


export default ParsedAnswer;
