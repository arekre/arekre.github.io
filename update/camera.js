/* Shared capture ownership: a late permission result must never revive a closed camera. */
(function (root) {
  function coverCrop(sw, sh, dw, dh) {
    if (![sw, sh, dw, dh].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid dimensions');
    const scale = Math.max(dw / sw, dh / sh);
    const width = dw / scale, height = dh / scale;
    return { x: (sw - width) / 2, y: (sh - height) / 2, width, height };
  }
  class CameraSession {
    constructor(mediaDevices) { this.mediaDevices = mediaDevices; this.stream = null; this.generation = 0; }
    stop() {
      this.generation++;
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    async open(facingMode, exact = false) {
      this.stop();
      const generation = this.generation;
      if (!this.mediaDevices?.getUserMedia) throw new Error('HTTPSまたはlocalhostで開いてください。');
      const stream = await this.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: exact ? { exact: facingMode } : { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Cancelled', 'AbortError');
      }
      this.stream = stream;
      return stream;
    }
  }
  function cameraError(error) {
    return ({ NotAllowedError: 'カメラが許可されていません。ブラウザの設定で許可し、再試行してください。',
      NotFoundError: '利用できるカメラが見つかりません。', NotReadableError: 'カメラを使用できません。他のアプリで使用中の場合は閉じてください。',
      OverconstrainedError: '指定したカメラがありません。', AbortError: 'カメラの起動を中断しました。' })[error.name] || error.message || 'カメラを起動できませんでした。';
  }
  const api = { CameraSession, coverCrop, cameraError };
  if (typeof module !== 'undefined') module.exports = api;
  else root.RosaCamera = api;
})(typeof window !== 'undefined' ? window : this);
