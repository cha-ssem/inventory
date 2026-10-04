import { html } from '../dom.js'
import { openModal, toast } from '../feedback.js'

const SCANNER_ID = 'camera-scanner-view'

const cameraUnavailableReason = () => {
  if (!window.isSecureContext) return '카메라는 보안 연결(https 또는 localhost)에서만 쓸 수 있습니다. "npm run preview"로 실행하세요.'
  if (!navigator.mediaDevices?.getUserMedia) return '이 브라우저에서는 카메라를 쓸 수 없습니다.'
  return null
}

const startScanner = async (onDecoded) => {
  // 카메라를 열 때만 라이브러리를 초기화한다
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
  const scanner = new Html5Qrcode(SCANNER_ID, {
    formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
    verbose: false,
  })
  await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 280, height: 160 } }, onDecoded, () => {})
  return scanner
}

const stopScanner = async (scanner) => {
  try {
    if (scanner?.isScanning) await scanner.stop()
    scanner?.clear()
  } catch (error) {
    console.error('카메라를 끄지 못했습니다:', error)
  }
}

export const openCameraScanner = ({ onDetected }) => {
  const reason = cameraUnavailableReason()
  if (reason) {
    toast(reason, 'error')
    return
  }
  let scanner = null
  let done = false
  openModal({
    title: '카메라로 스캔',
    content: html`<div id="${SCANNER_ID}" class="camera-view"></div>
      <p class="muted">바코드나 QR 코드를 화면 가운데 상자에 맞추세요.</p>
      <div class="form-actions"><button type="button" class="btn" data-dismiss>닫기</button></div>`,
    onMount: (dialog, close) => {
      dialog.querySelector('[data-dismiss]').addEventListener('click', close)
      startScanner((text) => {
        if (done) return
        done = true
        close()
        onDetected(text)
      })
        .then((instance) => {
          scanner = instance
          if (done) stopScanner(scanner)
        })
        .catch((error) => {
          console.error('카메라 시작 실패:', error)
          toast('카메라를 시작하지 못했습니다. 카메라 권한을 허용했는지 확인하세요.', 'error')
          close()
        })
    },
    onClose: () => {
      done = true
      stopScanner(scanner)
    },
  })
}
