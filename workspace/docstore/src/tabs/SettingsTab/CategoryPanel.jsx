import { useState, useEffect, useCallback, useContext } from 'react';
import { CategoriesContext } from '../../contexts/CategoriesContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Card from '../../components/ui/Card';


    function CategoryPanel() {
      const { categories, reload } = useContext(CategoriesContext);
      const [items, setItems] = useState([]);
      const [newValue, setNewValue] = useState('');
      const [newLabel, setNewLabel] = useState('');
      const [editIdx, setEditIdx] = useState(-1);
      const [editValue, setEditValue] = useState('');
      const [editLabel, setEditLabel] = useState('');
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState('');

      // 카테고리 로드 시 로컬 상태 동기화
      useEffect(() => { setItems(categories.map(c => ({ ...c }))); }, [categories]);

      // 서버에 저장
      const saveToServer = useCallback(async (newItems) => {
        setSaving(true);
        setMsg('');
        try {
          const res = await authFetch(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'categories', value: newItems }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '저장 실패');
          }
          await reload();
          setMsg('저장 완료');
          setTimeout(() => setMsg(''), 2000);
        } catch (err) {
          setMsg(`오류: ${err.message}`);
        } finally {
          setSaving(false);
        }
      }, [reload]);

      // 추가
      const handleAdd = useCallback(() => {
        const v = newValue.trim();
        const l = newLabel.trim() || v;
        if (!v) return;
        if (items.some(c => c.value === v)) { setMsg('이미 존재하는 카테고리입니다.'); return; }
        const next = [...items, { value: v, label: l }];
        setItems(next);
        setNewValue('');
        setNewLabel('');
        saveToServer(next);
      }, [items, newValue, newLabel, saveToServer]);

      // 삭제
      const handleDelete = useCallback((idx) => {
        const next = items.filter((_, i) => i !== idx);
        setItems(next);
        saveToServer(next);
      }, [items, saveToServer]);

      // 수정 시작
      const startEdit = useCallback((idx) => {
        setEditIdx(idx);
        setEditValue(items[idx].value);
        setEditLabel(items[idx].label);
      }, [items]);

      // 수정 저장
      const handleEditSave = useCallback(() => {
        const v = editValue.trim();
        const l = editLabel.trim() || v;
        if (!v) return;
        const next = items.map((c, i) => i === editIdx ? { value: v, label: l } : c);
        setItems(next);
        setEditIdx(-1);
        saveToServer(next);
      }, [items, editIdx, editValue, editLabel, saveToServer]);

      // 순서 변경 (위/아래)
      const handleMove = useCallback((idx, dir) => {
        const next = [...items];
        const target = idx + dir;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target], next[idx]];
        setItems(next);
        saveToServer(next);
      }, [items, saveToServer]);

      return (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-bold text-text mb-3">카테고리 관리</h3>
            <p className="text-xs text-text-secondary mb-4">문서 업로드 및 필터에 사용되는 카테고리를 관리합니다.</p>

            {/* 카테고리 목록 */}
            <div className="space-y-2 mb-4">
              {items.map((cat, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-bg rounded-lg border border-border">
                  {editIdx === idx ? (
                    <>
                      <input value={editValue} onChange={e => setEditValue(e.target.value)}
                        className="flex-1 px-2 py-1 text-sm bg-card-bg border border-primary rounded focus:outline-none text-text"
                        placeholder="값" />
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                        className="flex-1 px-2 py-1 text-sm bg-card-bg border border-primary rounded focus:outline-none text-text"
                        placeholder="표시명" />
                      <button onClick={handleEditSave} className="px-2 py-1 text-xs bg-primary text-white rounded hover:opacity-80">저장</button>
                      <button onClick={() => setEditIdx(-1)} className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:opacity-80">취소</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-text">{cat.label}</span>
                      <span className="text-xs text-text-secondary bg-card-bg px-1.5 py-0.5 rounded">{cat.value}</span>
                      <div className="flex gap-1">
                        <button onClick={() => handleMove(idx, -1)} disabled={idx === 0}
                          className="w-6 h-6 text-xs rounded hover:bg-border disabled:opacity-30"
                          title="위로">&#9650;</button>
                        <button onClick={() => handleMove(idx, 1)} disabled={idx === items.length - 1}
                          className="w-6 h-6 text-xs rounded hover:bg-border disabled:opacity-30"
                          title="아래로">&#9660;</button>
                        <button onClick={() => startEdit(idx)}
                          className="w-6 h-6 text-xs rounded hover:bg-blue-50 text-blue-500"
                          title="수정">&#9998;</button>
                        <button onClick={() => handleDelete(idx)}
                          className="w-6 h-6 text-xs rounded hover:bg-red-50 text-red-500"
                          title="삭제">&#10005;</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-sm text-text-secondary text-center py-4">등록된 카테고리가 없습니다.</p>
              )}
            </div>

            {/* 새 카테고리 추가 */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-text-secondary mb-1">카테고리명</label>
                <input value={newValue} onChange={e => { setNewValue(e.target.value); if (!newLabel) setNewLabel(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  className="w-full px-3 py-2 text-sm bg-card-bg border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-text"
                  placeholder="예: 매뉴얼" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-text-secondary mb-1">표시명 (선택)</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  className="w-full px-3 py-2 text-sm bg-card-bg border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-text"
                  placeholder="비워두면 카테고리명과 동일" />
              </div>
              <button onClick={handleAdd} disabled={saving || !newValue.trim()}
                className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
                추가
              </button>
            </div>

            {/* 상태 메시지 */}
            {msg && (
              <p className={`text-xs mt-2 ${msg.startsWith('오류') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>
            )}
          </Card>

          {/* 안내 */}
          <Card>
            <h4 className="text-sm font-bold text-text mb-2">안내</h4>
            <ul className="text-xs text-text-secondary space-y-1">
              <li>* 카테고리를 삭제해도 기존 문서의 카테고리 값은 유지됩니다.</li>
              <li>* 카테고리 값(value)을 수정하면 기존 문서에는 반영되지 않습니다.</li>
              <li>* 순서를 변경하면 업로드/필터 드롭다운에 반영됩니다.</li>
            </ul>
          </Card>
        </div>
      );
    }



export default CategoryPanel;
