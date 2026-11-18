(() => {
  'use strict';
  const node = document.getElementById('evergreen-mod-catalog');
  const loaderChoices = [...document.querySelectorAll('input[name="evergreen-loader"]')];
  const version = document.getElementById('evergreen-mc-version');
  const link = document.getElementById('evergreen-mod-download');
  const detail = document.getElementById('evergreen-mod-detail');
  const instruction = document.getElementById('evergreen-loader-instruction');
  if (!node || !version || !link || !detail) return;
  const names = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };
  let releases;
  try {
    releases = JSON.parse(node.textContent).releases.filter(entry =>
      names[entry.loader] && typeof entry.minecraft === 'string' &&
      /^[a-zA-Z0-9_.+-]+\.jar$/.test(entry.fileName) && /^[a-f0-9]{64}$/i.test(entry.sha256));
  } catch (_) { detail.textContent = '버전 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.'; return; }
  const compareVersions = (a, b) => {
    const aa = a.minecraft.split('.').map(Number), bb = b.minecraft.split('.').map(Number);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const diff = (bb[i] || 0) - (aa[i] || 0);
      if (diff) return diff;
    }
    return 0;
  };
  const selectedLoader = () => loaderChoices.find(input => input.checked)?.value || 'fabric';
  const updateDownload = () => {
    const loader = selectedLoader();
    const entry = releases.find(item => item.loader === loader && item.minecraft === version.value);
    if (!entry) {
      link.removeAttribute('href'); link.removeAttribute('download'); link.setAttribute('aria-disabled', 'true');
      detail.textContent = '이 로더의 다운로드 파일을 준비하고 있어요.';
      return;
    }
    link.removeAttribute('aria-disabled');
    link.href = entry.fileName;
    link.download = entry.fileName;
    link.textContent = `↓ ${names[loader]} ${entry.minecraft} 모드 다운로드`;
    const stability = entry.loaderStability === 'beta' ? ' (베타)' : '';
    detail.textContent = `Minecraft ${entry.minecraft} · ${names[loader]} ${entry.loaderVersion}${stability} · Java ${entry.minimumJava || 25} 이상`;
    instruction.textContent = loader === 'fabric'
      ? '필요한 Fabric API 모듈은 모드 파일에 포함돼 있어요.'
      : `${names[loader]} 프로필에 설치해 주세요. Fabric용 파일과 함께 넣지 마세요.`;
  };
  const updateVersions = () => {
    const previous = version.value;
    const entries = releases.filter(entry => entry.loader === selectedLoader()).sort(compareVersions);
    version.replaceChildren(...entries.map(entry => {
      const option = document.createElement('option');
      option.value = entry.minecraft; option.textContent = `Minecraft ${entry.minecraft}`;
      return option;
    }));
    if (entries.some(entry => entry.minecraft === previous)) version.value = previous;
    version.disabled = entries.length === 0;
    updateDownload();
  };
  loaderChoices.forEach(input => input.addEventListener('change', updateVersions));
  version.addEventListener('change', updateDownload);
  updateVersions();
})();
