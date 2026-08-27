import React, { useState } from "react";
import {
  X,
  CreditCard,
  QrCode,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Smartphone,
  Building2,
} from "lucide-react";

interface XenditPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  amount: number;
  customerName: string;
  invoiceUrl?: string;
  isMock?: boolean;
  onPaymentSuccess: () => void;
}

type PaymentChannel = "gcash" | "maya" | "card" | "qrph" | "bank";

export function XenditPaymentModal({
  isOpen,
  onClose,
  orderId,
  amount,
  customerName,
  invoiceUrl,
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

  if (!isOpen) return null;

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
      const handleActionEnd = () => {
        if (actionContainerRef.current) actionContainerRef.current.replaceChildren();
      };
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

  const handleOpenXenditHosted = () => {
      if (!componentsRef.current || !isReady || isProcessing) return;
      setError("");
      setIsProcessing(true);
      componentsRef.current.submit();

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#121214] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-white font-sans">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
              X
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">Xendit Checkout</h3>
              <p className="text-xs text-neutral-400">Order #{orderId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          componentsSdkKey,
        </div>

        {/* Modal Body */}
        {isPaid ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h4 className="text-xl font-bold text-white">Payment Successful!</h4>
            <p className="text-sm text-neutral-400">
              Your order <span className="text-white font-semibold">{orderId}</span> has been confirmed. Redirecting...
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Total Amount Badge */}
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-yellow-500/10 border border-orange-500/20 rounded-xl">
              <div>
                <span className="text-xs text-neutral-400 uppercase tracking-wider block">Total Payable</span>
                <span className="text-2xl font-black text-white">₱{amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-neutral-400 block">Customer</span>
                <span className="text-xs font-semibold text-neutral-200">{customerName}</span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider block mb-3">
                Select Payment Channel
              </label>

              <div className="grid grid-cols-2 gap-2.5">
                {/* GCash */}
                <button
                  type="button"
                  onClick={() => setSelectedChannel("gcash")}
                  className={`flex items-center space-x-3 p-3 rounded-xl border text-left transition-all ${
                    selectedChannel === "gcash"
                      ? "border-blue-500 bg-blue-500/10 text-white shadow-lg shadow-blue-500/10"
                      : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/20"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                    G
                  </div>
                  <div>
                    <div className="text-xs font-bold">GCash</div>
                    <div className="text-[10px] text-neutral-400">E-Wallet</div>
                  </div>
                </button>

                {/* Maya */}
                <button
                  type="button"
                  onClick={() => setSelectedChannel("maya")}
                  className={`flex items-center space-x-3 p-3 rounded-xl border text-left transition-all ${
                    selectedChannel === "maya"
                      ? "border-emerald-500 bg-emerald-500/10 text-white shadow-lg shadow-emerald-500/10"
                      : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/20"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-xs">
                    M
                  </div>
                  <div>
                    <div className="text-xs font-bold">Maya</div>
                    <div className="text-[10px] text-neutral-400">PayMaya</div>
                  </div>
                </button>

                {/* QR Ph */}
                <button
                  type="button"
                  onClick={() => setSelectedChannel("qrph")}
                  className={`flex items-center space-x-3 p-3 rounded-xl border text-left transition-all ${
                    selectedChannel === "qrph"
                      ? "border-purple-500 bg-purple-500/10 text-white shadow-lg shadow-purple-500/10"
                      : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/20"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold">QR Ph</div>
                    <div className="text-[10px] text-neutral-400">Scan & Pay</div>
                  </div>
                </button>

                {/* Credit Card */}
                <button
                  type="button"
                  onClick={() => setSelectedChannel("card")}
                  className={`flex items-center space-x-3 p-3 rounded-xl border text-left transition-all ${
                    selectedChannel === "card"
                      ? "border-orange-500 bg-orange-500/10 text-white shadow-lg shadow-orange-500/10"
                      : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/20"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold">Card</div>
                    <div className="text-[10px] text-neutral-400">Visa / Mastercard</div>
                  </div>
                </button>
              </div>
            </div>

            {/* QR Code / Simulated View */}
            {selectedChannel === "qrph" ? (
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-center space-y-2">
                <div className="w-32 h-32 bg-white rounded-lg p-2 mx-auto flex items-center justify-center">
                  <QrCode className="w-28 h-28 text-black" />
                </div>
                <p className="text-[11px] text-neutral-400">Scan QR Ph using GCash, Maya, BPI, or any banking app</p>
              </div>
            ) : (
              <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl flex items-center space-x-3 text-xs text-neutral-300">
                <Smartphone className="w-5 h-5 text-blue-400 shrink-0" />
                <span>
                  Instant payment verification via <strong className="text-white capitalize">{selectedChannel}</strong>
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleCompletePayment}
                disabled={isProcessing}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-bold text-sm rounded-xl shadow-lg shadow-orange-500/20 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing Payment...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Authorize & Pay ₱{amount.toFixed(2)}</span>
                  </>
                )}
              </button>

              {invoiceUrl && !isMock && (
                <button
                  type="button"
                  onClick={handleOpenXenditHosted}
                  className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center space-x-2"
                >
                  <span>Open Official Xendit Hosted Checkout</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Footer Trust Badge */}
            <div className="flex items-center justify-center space-x-1.5 text-[11px] text-neutral-500 pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Secured by Xendit 256-bit Encryption</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
