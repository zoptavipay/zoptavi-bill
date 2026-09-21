import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import './BarcodeScanner.css';

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

// Chrome/Android's built-in BarcodeDetector is far more reliable at reading real product
// barcodes (EAN-13/UPC) than a pure-JS decoder — use it whenever the browser has it.
type NativeDetector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => NativeDetector;
  }
}

const PRODUCT_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingNative, setUsingNative] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startNative() {
      const detector = new window.BarcodeDetector!({ formats: PRODUCT_BARCODE_FORMATS });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const tick = async () => {
        if (cancelled) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            // Release the camera immediately, rather than waiting for this component to
            // unmount — reopening the scanner right after a scan can otherwise hit the
            // camera while the browser still considers it "busy" from the last session.
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            if (video) video.srcObject = null;
            onDetected(codes[0].rawValue);
            return;
          }
        } catch {
          // transient decode errors are normal while no barcode is in frame
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
    }

    async function startZxing() {
      // TRY_HARDER + a narrower, relevant format list meaningfully improves real-world 1D
      // barcode reads (EAN/UPC on product packaging) vs the library's bare defaults.
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE,
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      // Ask for the highest resolution the camera offers — a sharper frame is the single
      // biggest lever for decoding small, real-world barcodes reliably.
      const constraints: MediaStreamConstraints = {
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      };
      await reader.decodeFromConstraints(constraints, videoRef.current ?? undefined, (result, _err, controls) => {
        controlsRef.current = controls;
        if (cancelled) return;
        if (result) {
          controls.stop();
          onDetected(result.getText());
        }
      });
    }

    async function start() {
      try {
        if (window.BarcodeDetector) {
          setUsingNative(true);
          await startNative();
        } else {
          setUsingNative(false);
          await startZxing();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not access camera');
      }
    }

    start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scanner-modal">
      <div className="scanner-modal-inner">
        <div className="scanner-header">
          <h2>Scan barcode</h2>
          <button className="scanner-close" onClick={onClose}>×</button>
        </div>
        {error ? (
          <div className="scanner-error">
            <p>{error}</p>
            <p className="scanner-hint">
              You can also just plug in a USB/Bluetooth barcode scanner and scan into the search box —
              it works like a keyboard, no camera needed.
            </p>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="scanner-video" muted playsInline />
            <p className="scanner-hint">
              Hold the barcode flat, well-lit, and fill most of the frame — a few centimetres from the lens
              usually focuses best.{usingNative === false && ' (Falling back to a slower software scanner on this browser.)'}
            </p>
          </>
        )}
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
