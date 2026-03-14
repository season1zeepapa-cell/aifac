import { useState, useEffect, useCallback, useContext } from 'react';
import { CategoriesContext } from '../../contexts/CategoriesContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';


    function ChunkPresetPanel() {
      const { categories } = useContext(CategoriesContext);
      const [presets, setPresets] = useState({});
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [message, setMessage] = useState(null);

      const STRATEGY_OPTIONS = [
        { value: 'sentence', label: '문장 단위' },
        { value: 'recursive', label: '재귀적 분할' },
        { value: 'law-article', label: '법령 조문' },
        { value: 'markdown', label: 'Markdown 헤딩' },
        { value: 'semantic', label: '의미 분할 (임베딩)' },
        { value: 'semantic-llm', label: 'AI 의미 분할 (LLM)' },
      ];

      // 기본 프리셋
      const DEFAULT_PRESETS = {
        '법령':   { strategy: 'law-article', chunkSize: 800, overlap: 0 },
        '규정':   { strategy: 'law-article', chunkSize: 800, overlap: 0 },
        '기출':   { strategy: 'sentence',    chunkSize: 400, overlap: 50 },
        '크롤링': { strategy: 'recursive',   chunkSize: 600, overlap: 100 },
        '기타':   { strategy: 'recursive',   chunkSize: 500, overlap: 100 },
      };

      // 서버에서 저장된 프리셋 로드
      const fetchPresets = useCallback(async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/settings?key=chunk_presets`);
          const data = await res.json();
          const saved = data.value || {};
          // 각 카테고리별로 저장된 값 또는 기본값 사용
          const merged = {};
          for (const cat of categories) {
            merged[cat.value] = saved[cat.value] || DEFAULT_PRESETS[cat.value] || { strategy: 'recursive', chunkSize: 500, overlap: 100 };
          }
          setPresets(merged);
          // 전역 변수에도 저장 (UploadTab에서 참조)
          window.__chunkPresets = merged;
        } catch (err) {
          console.error('[분할 프리셋]', err);
        } finally {
          setLoading(false);
        }
      }, [categories]);

      useEffect(() => { fetchPresets(); }, [fetchPresets]);

      // 개별 카테고리 프리셋 변경
      const updatePreset = (catValue, field, value) => {
        setPresets(prev => ({
          ...prev,
          [catValue]: { ...prev[catValue], [field]: value },
        }));
      };

      // 전체 저장
      const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'chunk_presets', value: presets }),
          });
          if (!res.ok) throw new Error('저장 실패');
          window.__chunkPresets = presets;
          setMessage({ type: 'success', text: '분할 설정이 저장되었습니다.' });
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        } finally {
          setSaving(false);
          setTimeout(() => setMessage(null), 3000);
        }
      };

      if (loading) return <div className="text-center py-8 text-text-secondary text-sm">로딩 중...</div>;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-text">카테고리별 기본 분할 설정</h3>
              <p className="text-xs text-text-secondary mt-0.5">업로드 시 카테고리를 선택하면 이 설정이 자동 적용됩니다</p>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? '저장 중...' : '전체 저장'}
            </button>
          </div>

          {message && (
            <div className={`text-xs px-3 py-2 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
              {message.text}
            </div>
          )}

          <div className="space-y-3">
            {categories.map(cat => {
              const preset = presets[cat.value] || {};
              return (
                <Card key={cat.value} className="border-border">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">{cat.label}</span>
                      <span className="text-[10px] text-text-secondary bg-border px-2 py-0.5 rounded-full">
                        {preset.strategy || 'recursive'} / {preset.chunkSize || 500}자 / 겹침 {preset.overlap ?? 100}자
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      <div>
                        <label className="block text-[10px] text-text-secondary mb-0.5">전략</label>
                        <select value={preset.strategy || 'recursive'}
                          onChange={e => updatePreset(cat.value, 'strategy', e.target.value)}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-bg text-text">
                          {STRATEGY_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-text-secondary mb-0.5">청크 크기</label>
                        <input type="number" min="200" max="2000" step="50"
                          value={preset.chunkSize || 500}
                          onChange={e => updatePreset(cat.value, 'chunkSize', parseInt(e.target.value) || 500)}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-bg text-text" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-text-secondary mb-0.5">겹침</label>
                        <input type="number" min="0" max="500" step="25"
                          value={preset.overlap ?? 100}
                          onChange={e => updatePreset(cat.value, 'overlap', parseInt(e.target.value) || 0)}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-bg text-text" />
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      );
    }



export default ChunkPresetPanel;
