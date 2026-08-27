import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, X } from "lucide-react";
import { XenditComponents } from "xendit-components-web";

interface XenditPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  amount: number;
  customerName: string;
  componentsSdkKey: string;
  onPaymentSuccess: () => void;
}

export function XenditPaymentModal({
  isOpen,
  onClose,
  orderId,
  amount,
  customerName,
  componentsSdkKey,
  onPaymentSuccess,
}: XenditPaymentModalProps) {
  const paymentContainerRef = useRef<HTMLDivElement>(null);
  const actionContainerRef = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<XenditComponents | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !componentsSdkKey || !paymentContainerRef.current) return;

    const components = new XenditComponents({ componentsSdkKey });
    componentsRef.current = components;
    paymentContainerRef.current.replaceChildren(components.createChannelPickerComponent());

    const handleReady = () => setIsReady(true);
    const handleNotReady = () => setIsReady(false);
    const handleActionBegin = () => {
      if (actionContainerRef.current) {
        actionContainerRef.current.replaceChildren(
          components.createActionContainerComponent({ qrCode: { qrCodeOnly: false } }),
        );
      }
    };
    const handleActionEnd = () => actionContainerRef.current?.replaceChildren();
    const handleComplete = () => {
      setIsProcessing(false);
      setIsPaid(true);
      window.setTimeout(onPaymentSuccess, 900);
    };
    const handleExpired = () => {
      setIsProcessing(false);
      setError("This payment session expired or was cancelled. Please try again.");
    };

    components.addEventListener("submission-ready", handleReady);
    components.addEventListener("submission-not-ready", handleNotReady);
    components.addEventListener("action-begin", handleActionBegin);
    components.addEventListener("action-end", handleActionEnd);
    components.addEventListener("session-complete", handleComplete);
    components.addEventListener("session-expired-or-canceled", handleExpired);

    return () => {
      components.removeEventListener("submission-ready", handleReady);
      components.removeEventListener("submission-not-ready", handleNotReady);
      components.removeEventListener("action-begin", handleActionBegin);
      components.removeEventListener("action-end", handleActionEnd);
      components.removeEventListener("session-complete", handleComplete);
      components.removeEventListener("session-expired-or-canceled", handleExpired);
      componentsRef.current = null;
      setIsReady(false);
    };
  }, [componentsSdkKey, isOpen, onPaymentSuccess]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!componentsRef.current || !isReady || isProcessing) return;
    setError("");
    setIsProcessing(true);
    componentsRef.current.submit();
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111111] text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FF8A80]">Secure payment</p>
            <h3 className="mt-1 text-xl font-black">Complete your Bun & Bite order</h3>
            <p className="mt-1 text-xs text-white/45">Order #{orderId}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/45 transition hover:bg-white/10 hover:text-white" aria-label="Close payment">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isPaid ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-400" />
            <h4 className="mt-5 text-2xl font-black">Payment received</h4>
            <p className="mt-2 text-sm text-white/55">Your order is being confirmed.</p>
          </div>
        ) : (
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between rounded-2xl border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 p-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.15em] text-[#FFB4AB]">Total payable</p>
                <p className="mt-1 text-2xl font-black">₱{amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
              </div>
              <p className="max-w-[45%] text-right text-xs font-bold text-white/60">{customerName}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 sm:p-4">
              <div ref={paymentContainerRef} className="xendit-components" />
              <div ref={actionContainerRef} className="mt-3" />
            </div>

            {error && <p className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isReady || isProcessing}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B3B] px-4 py-3.5 text-sm font-black text-white transition hover:bg-[#ff5252] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {isProcessing ? "Processing payment..." : `Pay ₱${amount.toFixed(2)}`}
            </button>

            <div className="flex items-center justify-center gap-2 text-center text-[11px] text-white/35">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Payment details are securely handled by Xendit.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
