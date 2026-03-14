import { useContext } from 'react';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';

// 비활성 API 경고 배너
export default function DisabledApiBanner({ providers, featureName }) {
  const { isApiDisabled, disabledApis } = useContext(ApiKeyStatusContext);
  const providerLabels = {
    openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini',
    cohere: 'Cohere', upstage: 'Upstage', 'law-api': '국가법령정보센터',
  };
  const disabled = (Array.isArray(providers) ? providers : [providers]).filter(p => disabledApis[p]);
  if (disabled.length === 0) return null;
  return (
    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
      <span className="font-bold">API 비활성:</span>{' '}
      {disabled.map(p => providerLabels[p] || p).join(', ')}이(가) 비활성 상태입니다.
      {featureName && <span> <b>{featureName}</b> 기능을 사용하려면 설정 &gt; API 키에서 활성화해주세요.</span>}
    </div>
  );
}
