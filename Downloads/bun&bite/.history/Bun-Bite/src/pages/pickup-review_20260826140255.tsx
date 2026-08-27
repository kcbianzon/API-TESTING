import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";
import Navbar from "@/components/navbar";
import { CustomizeModal, PRODUCTS } from "@/components/menu";
import VoucherBox from "@/components/voucher-box";
import { useAuth } from "@/context/auth-context";
import { auth, db } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  buildCartItemSummary,
  formatCartMoney,
  type CartCurrency,
  type CartCustomization,
  type CartItem,
} from "@/lib/cart";
import { clearUserFirestoreCart, createOrder, type PaymentMethod } from "@/lib/orders";
import { getPickupBranch } from "@/lib/pickup";
import {
  calculateVoucherDiscount,
  hasUserRedeemedVoucher,
  validateVoucher,
  type AppliedVoucher,
} from "@/lib/vouchers";

interface PickupReviewPageProps {
  cartCount: number;
  cartItems: CartItem[];
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  checkoutMode?: boolean;
}

interface PersonalDetails {
  email: string;
  firstName: string;
  lastName: string;
  mobile: string;
}

type PickupPaymentMethod = Extract<PaymentMethod, "cash_on_pickup" | "xendit" | "paymongo">;

const PAYMENT_METHODS: Array<{
  id: PickupPaymentMethod;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "cash_on_pickup",
    title: "Cash on Pickup",
    description: "Pay at the branch when you claim your order.",
    icon: Banknote,
  },
  {
    id: "xendit",
    title: "Online Payment (Xendit)",
    description: "Pay securely via GCash, Maya, GrabPay, Cards, or QR Ph.",
    icon: CreditCard,
  },
];

const EMPTY_DETAILS: PersonalDetails = {
  email: "",
  firstName: "",
  lastName: "",
  mobile: "",
};

export default function PickupReviewPage({
  cartCount,
  cartItems,
  updateItem,
  removeItem,
  clearCart,
  checkoutMode = false,
}: PickupReviewPageProps) {
  const { requireAuth, user, profile } = useAuth();
  const [location, setLocation] = useLocation();
  const pathParts = location.split("/").filter(Boolean);
  const isCheckoutPickupReview =
    checkoutMode || (pathParts[0] === "checkout" && pathParts[1] === "pickup");
  const branchId = isCheckoutPickupReview ? pathParts[2] : pathParts[1];
  const branch = getPickupBranch(branchId);
  const [personalDetails, setPersonalDetails] = useState<PersonalDetails>(EMPTY_DETAILS);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<AppliedVoucher | null>(null);
  const [voucherError, setVoucherError] = useState("");
  const [voucherMessage, setVoucherMessage] = useState("");
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PickupPaymentMethod>("cash_on_pickup");
  const editingProduct = useMemo(() => {
    if (!editingItem || editingItem.isDeal || editingItem.isCombo) return null;
    return PRODUCTS.find((product) => product.id === editingItem.productId) || null;
  }, [editingItem]);

  useEffect(() => {
    if (!profile && !user) return;

    setPersonalDetails((details) => ({
      email: details.email || profile?.email || user?.email || "",
      firstName: details.firstName || profile?.firstName || "",
      lastName: details.lastName || profile?.lastName || "",
      mobile: details.mobile || profile?.mobileNumber || profile?.mobile || "",
    }));
  }, [profile, user]);

  const totals = useMemo(() => {
    const subtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const vat = 0;
    const serviceFee = cartItems.length > 0 ? 15 : 0;
    const voucherDiscount = appliedVoucher
      ? calculateVoucherDiscount(appliedVoucher, subtotal, 0, "pickup")
      : 0;
    const total = Math.max(0, subtotal + vat + serviceFee - voucherDiscount);

    return { subtotal, vat, serviceFee, voucherDiscount, total };
  }, [appliedVoucher, cartItems]);

  useEffect(() => {
    if (!appliedVoucher) return;
    if (totals.subtotal > 0 && totals.voucherDiscount > 0) return;

    setVoucherError(`${appliedVoucher.code} was removed because this order no longer meets the voucher rules.`);
    setVoucherMessage("");
    setAppliedVoucher(null);
  }, [appliedVoucher, totals.subtotal, totals.voucherDiscount]);

  const detailsComplete =
    personalDetails.email.trim().length > 0 &&
    personalDetails.firstName.trim().length > 0 &&
    personalDetails.lastName.trim().length > 0 &&
    personalDetails.mobile.trim().length > 0;

  const canPlaceOrder = detailsComplete && cartItems.length > 0 && !placingOrder;

  const updateDetail = (field: keyof PersonalDetails, value: string) => {
    setPersonalDetails((details) => ({ ...details, [field]: value }));
    setDetailsSaved(false);
    setDetailsMessage("");
    setDetailsError("");
  };

  const handleSavePersonalDetails = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser || !detailsComplete || detailsSaving) return;

      setDetailsSaving(true);
      setDetailsError("");
      setDetailsMessage("");

      try {
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            uid: currentUser.uid,
            email: personalDetails.email.trim(),
            firstName: personalDetails.firstName.trim(),
            lastName: personalDetails.lastName.trim(),
            mobile: personalDetails.mobile.trim(),
            mobileNumber: personalDetails.mobile.trim(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setDetailsSaved(true);
        setDetailsMessage("Personal details saved.");
      } catch {
        setDetailsError("We couldn't save your personal details yet. Please try again.");
      } finally {
        setDetailsSaving(false);
      }
    });
  };

  const handleApplyVoucher = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const result = validateVoucher({
        code: voucherCode,
        subtotal: totals.subtotal,
        deliveryFee: 0,
        orderType: "pickup",
        userId: currentUser.uid,
      });

      if (!result.ok) {
        setVoucherError(result.message);
        setVoucherMessage("");
        setAppliedVoucher(null);
        return;
      }

      if (result.voucher.oneTime && (await hasUserRedeemedVoucher(currentUser.uid, result.voucher.code))) {
        setVoucherError("This voucher was already used by this account.");
        setVoucherMessage("");
        setAppliedVoucher(null);
        return;
      }

      setAppliedVoucher(result.voucher);
      setVoucherCode(result.voucher.code);
      setVoucherError("");
      setVoucherMessage(result.message);
    });
  };

  const handleRemoveVoucher = () => {
    setAppliedVoucher(null);
    setVoucherCode("");
    setVoucherError("");
    setVoucherMessage("Voucher removed.");
  };

  const getSizeIdx = (sizeLabel: string) => {
    if (!editingProduct) return 0;
    const idx = editingProduct.sizes?.findIndex((size) => size.label === sizeLabel) ?? -1;
    return idx >= 0 ? idx : 0;
  };

  const handleEditConfirm = (data: {
    size: string;
    addOns: string[];
    quantity: number;
    unitPrice: number;
    baseUnitPrice: number;
    addOnTotal: number;
    customization: CartCustomization;
    currency: CartCurrency;
  }) => {
    if (!editingItem) return;

    updateItem(editingItem.id, {
      size: data.size,
      addOns: data.addOns,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      baseUnitPrice: data.baseUnitPrice,
      addOnTotal: data.addOnTotal,
      customization: data.customization,
      currency: data.currency,
    });
    setEditingItem(null);
  };

  const handlePlaceOrder = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;

      if (!currentUser || !branch || cartItems.length === 0 || !detailsComplete || placingOrder) return;

      setPlacingOrder(true);
      setOrderError("");

      try {
        const order = await createOrder({
          userId: currentUser.uid,
          customer: {
            name: `${personalDetails.firstName.trim()} ${personalDetails.lastName.trim()}`.trim(),
            email: personalDetails.email.trim(),
            mobile: personalDetails.mobile.trim(),
          },
          orderType: "pickup",
          pickup: {
            branchId: branch.id,
            branchName: branch.name,
            branchAddress: branch.address,
            branchContact: branch.contact,
            pickupOption: "Standard pickup",
            estimatedTime: branch.prepTime,
          },
          items: cartItems,
          totals,
          voucher: appliedVoucher
            ? {
                ...appliedVoucher,
                discountAmount: totals.voucherDiscount,
              }
            : null,
          paymentMethod,
        });

        if (paymentMethod === "xendit" || paymentMethod === "paymongo") {
          const paymentApiUrl = import.meta.env.VITE_XENDIT_API_URL;
          if (!paymentApiUrl) throw new Error("Xendit payment API is not configured.");
          const idToken = await currentUser.getIdToken();
          const successUrl = `${window.location.origin}/order-success/${encodeURIComponent(order.orderId)}`;
          const cancelUrl = window.location.href;
          const invoiceRes = await fetch(`${paymentApiUrl}/create-invoice`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              orderId: order.orderId,
              amount: totals.total,
              customer: {
                name: `${personalDetails.firstName} ${personalDetails.lastName}`.trim(),
                email: personalDetails.email,
                mobile: personalDetails.mobile,
              },
              lineItems: cartItems.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
              successUrl,
              cancelUrl,
            }),
          });
          const invoiceData = await invoiceRes.json();
          if (!invoiceRes.ok || !invoiceData.invoiceUrl) {
            throw new Error(invoiceData.error || "Xendit invoice creation failed.");
          }

          await clearUserFirestoreCart(currentUser.uid);
          clearCart();
          window.location.href = invoiceData.invoiceUrl;
          return;
        }

        await clearUserFirestoreCart(currentUser.uid);
        clearCart();
        setLocation(`/order-success/${encodeURIComponent(order.orderId)}`);
      } catch {
        setOrderError("We couldn't place your pick-up order yet. Please check your connection and try again.");
      } finally {
        setPlacingOrder(false);
      }
    });
  };

  if (!branch) {
    return (
      <div className="min-h-[100dvh] overflow-x-hidden bg-[#050505] text-white">
        <Navbar cartCount={cartCount} showSearch={false} />
        <main className="px-4 pt-28">
          <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#111111] p-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
            <h1 className="font-display text-3xl font-black">Branch not found</h1>
            <p className="mt-3 text-white/50">Choose another pickup branch to continue your order.</p>
            <button
              onClick={() => setLocation(isCheckoutPickupReview ? "/checkout/pickup/branches" : "/pickup")}
              className="mt-6 h-11 rounded-full bg-[#FF3B3B] px-6 text-sm font-bold text-white transition-all hover:bg-[#ff5252]"
            >
              Back to Pickup Branches
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#050505] text-white">
      <Navbar cartCount={cartCount} showSearch={false} />

      <main className="pb-16 pt-24 md:pt-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Link
            href={isCheckoutPickupReview ? "/checkout/pickup/branches" : `/pickup/${branch.id}`}
            className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/50 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {isCheckoutPickupReview ? "Change pickup branch" : "Back to menu"}
          </Link>

          <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FF8A80]">
                Pick-up checkout
              </p>
              <h1 className="mt-2 font-display text-3xl font-black leading-tight sm:text-4xl md:text-5xl">
                Review and place your order
              </h1>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 px-4 py-2 text-sm font-bold text-[#FFB4AB]">
              <Clock className="h-4 w-4" />
              Standard pickup: {branch.prepTime}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0 space-y-6">
              <ReviewCard>
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                      Pick-up at
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-black text-white sm:text-3xl">
                      {branch.name}
                    </h2>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FF3B3B]/15 text-[#FF4D2E]">
                    <MapPin className="h-6 w-6" />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <InfoRow icon={MapPin} label="Address" value={branch.address} />
                  <InfoRow icon={Clock} label="Opening hours" value={branch.fullHours} />
                  <InfoRow icon={Phone} label="Contact number" value={branch.contact} />
                  <InfoRow icon={ShoppingBag} label="Pickup" value={branch.pickup} />
                </div>
              </ReviewCard>

              <ReviewCard>
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                      Pick-up options
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-black text-white sm:text-3xl">
                      Standard pickup
                    </h2>
                  </div>
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-300" />
                </div>

                <div className="rounded-2xl border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#FF3B3B]/35 bg-black/25">
                        <span className="h-3 w-3 rounded-full bg-[#FF3B3B] shadow-[0_0_16px_rgba(255,59,59,0.7)]" />
                      </span>
                      <div>
                        <p className="font-black text-white">Standard</p>
                        <p className="text-sm text-white/45">Prepared after checkout confirmation</p>
                      </div>
                    </div>
                    <p className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-sm font-black text-[#FFB4AB]">
                      {branch.prepTime}
                    </p>
                  </div>
                </div>
              </ReviewCard>

              <ReviewCard>
                <div className="mb-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                    Mode of payment
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-black text-white sm:text-3xl">
                    Choose how to pay
                  </h2>
                  <p className="mt-2 text-sm text-white/40">
                    Your selected payment mode will be saved with this pick-up order.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {PAYMENT_METHODS.map((method) => (
                    <PaymentMethodButton
                      key={method.id}
                      active={paymentMethod === method.id}
                      icon={method.icon}
                      title={method.title}
                      description={method.description}
                      onClick={() => setPaymentMethod(method.id)}
                    />
                  ))}
                </div>
              </ReviewCard>

              <ReviewCard>
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                      Personal details
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-black text-white sm:text-3xl">
                      Contact information
                    </h2>
                  </div>
                  {detailsSaved && (
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  )}
                </div>

                <div className="grid gap-4">
                  <Field
                    icon={Mail}
                    label="Email"
                    type="email"
                    value={personalDetails.email}
                    onChange={(value) => updateDetail("email", value)}
                    placeholder="your.email@example.com"
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      icon={User}
                      label="First name"
                      value={personalDetails.firstName}
                      onChange={(value) => updateDetail("firstName", value)}
                      placeholder="First name"
                    />
                    <Field
                      icon={User}
                      label="Last name"
                      value={personalDetails.lastName}
                      onChange={(value) => updateDetail("lastName", value)}
                      placeholder="Last name"
                    />
                  </div>

                  <Field
                    icon={Phone}
                    label="Mobile number"
                    type="tel"
                    value={personalDetails.mobile}
                    onChange={(value) => updateDetail("mobile", value)}
                    placeholder="+63 9XX XXX XXXX"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSavePersonalDetails}
                  disabled={!detailsComplete || detailsSaving}
                  className="mt-5 h-12 w-full rounded-full bg-[#FF3B3B] text-sm font-black text-white transition-all hover:bg-[#ff5252] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  {detailsSaving ? "Saving..." : "Save"}
                </button>

                {(detailsMessage || detailsError) && (
                  <p className={`mt-3 rounded-2xl border px-4 py-3 text-xs font-bold ${
                    detailsError
                      ? "border-[#FF3B3B]/25 bg-[#FF3B3B]/10 text-[#FFB4AB]"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  }`}>
                    {detailsError || detailsMessage}
                  </p>
                )}
              </ReviewCard>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-24 lg:h-fit">
              <OrderSummary
                branchName={branch.name}
                cartItems={cartItems}
                subtotal={totals.subtotal}
                vat={totals.vat}
                serviceFee={totals.serviceFee}
                voucherCode={voucherCode}
                appliedVoucher={appliedVoucher}
                voucherDiscount={totals.voucherDiscount}
                voucherError={voucherError}
                voucherMessage={voucherMessage}
                onVoucherCodeChange={(code) => {
                  setVoucherCode(code);
                  setVoucherError("");
                  setVoucherMessage("");
                }}
                onApplyVoucher={handleApplyVoucher}
                onRemoveVoucher={handleRemoveVoucher}
                total={totals.total}
                paymentMethodLabel={getPaymentMethodLabel(paymentMethod)}
                canPlaceOrder={canPlaceOrder}
                onAddMoreItems={() => setLocation(`/pickup/${branch.id}`)}
                onEditItem={(item) => requireAuth(() => setEditingItem(item))}
                onRemoveItem={removeItem}
                onPlaceOrder={handlePlaceOrder}
                placingOrder={placingOrder}
                orderError={orderError}
              />
            </aside>
          </div>

          <div className="mt-8 max-w-3xl text-xs leading-relaxed text-white/35">
            By placing this pick-up order, you confirm that your contact details are correct and agree to Bun & Bite order terms.
          </div>
        </div>
      </main>

      {editingItem && editingProduct && (
        <CustomizeModal
          product={editingProduct}
          onClose={() => setEditingItem(null)}
          onConfirm={handleEditConfirm}
          mode="edit"
          initialSizeIdx={getSizeIdx(editingItem.size)}
          initialAddOns={editingItem.addOns}
          initialQuantity={editingItem.quantity}
          initialCustomization={editingItem.customization}
          currency={editingItem.currency || "PHP"}
        />
      )}

    </div>
  );
}

function ReviewCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.22)] sm:p-6">
      {children}
    </section>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-white/8 bg-black/20 p-4">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#FF4D2E]" />
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-white/30">{label}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/70">{value}</p>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
        {label}
      </span>
      <span className="flex h-[52px] items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 transition-colors focus-within:border-[#FF3B3B]/45">
        <Icon className="h-4 w-4 shrink-0 text-[#FF4D2E]" />
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-white/25"
        />
      </span>
    </label>
  );
}

function OrderSummary({
  branchName,
  cartItems,
  subtotal,
  vat,
  serviceFee,
  voucherCode,
  appliedVoucher,
  voucherDiscount,
  voucherError,
  voucherMessage,
  onVoucherCodeChange,
  onApplyVoucher,
  onRemoveVoucher,
  total,
  paymentMethodLabel,
  canPlaceOrder,
  onAddMoreItems,
  onEditItem,
  onRemoveItem,
  onPlaceOrder,
  placingOrder,
  orderError,
}: {
  branchName: string;
  cartItems: CartItem[];
  subtotal: number;
  vat: number;
  serviceFee: number;
  voucherCode: string;
  appliedVoucher: AppliedVoucher | null;
  voucherDiscount: number;
  voucherError: string;
  voucherMessage: string;
  onVoucherCodeChange: (code: string) => void;
  onApplyVoucher: () => void;
  onRemoveVoucher: () => void;
  total: number;
  paymentMethodLabel: string;
  canPlaceOrder: boolean;
  onAddMoreItems: () => void;
  onEditItem: (item: CartItem) => void;
  onRemoveItem: (id: string) => void;
  onPlaceOrder: () => void;
  placingOrder: boolean;
  orderError: string;
}) {
  const summaryCurrency = getCartCurrency(cartItems);

  return (
    <section className="rounded-3xl border border-white/10 bg-[#111111]/95 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
      <div className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#FF8A80]">
          Your order from
        </p>
        <h2 className="mt-2 font-display text-2xl font-black leading-tight text-white">
          {branchName}
        </h2>
      </div>

      <div className="space-y-3">
        {cartItems.length > 0 ? (
          cartItems.map((item) => (
            <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-3 rounded-2xl bg-black/20 p-2.5">
              <img src={item.image} alt={item.name} className="h-11 w-11 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">{item.quantity} x {item.name}</p>
                <p className="mt-0.5 truncate text-xs text-white/35">{item.size}</p>
                {(item.isDeal || item.isCombo) && (
                  <p className="mt-0.5 truncate text-xs font-bold text-[#FF8A80]">
                    {item.isCombo ? "Build Your Bite combo" : item.discountLabel || "Deal price"}
                  </p>
                )}
                {buildCartItemSummary(item).length > 0 && (
                  <p className="mt-0.5 line-clamp-3 text-xs text-white/30">
                    {buildCartItemSummary(item).join(" / ")}
                  </p>
                )}
                {!item.isDeal && !item.isCombo && (
                  <button
                    type="button"
                    onClick={() => onEditItem(item)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-black text-white/55 transition-all hover:border-[#FF3B3B]/35 hover:text-white"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                )}
              </div>
              <div className="text-right">
                {item.originalPrice && (
                  <p className="text-xs font-bold text-white/25 line-through">
                    {formatMoney(item.originalPrice * item.quantity, item.currency)}
                  </p>
                )}
                <p className="text-sm font-black text-[#FFB4AB]">
                  {formatMoney(item.unitPrice * item.quantity, item.currency)}
                </p>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  aria-label={`Remove ${item.name} from order`}
                  className="mt-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 text-[#FF8A80] transition-all hover:border-[#FF3B3B]/55 hover:bg-[#FF3B3B]/20 hover:text-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
            <p className="font-black text-white">Your order is empty.</p>
            <p className="mt-1 text-sm text-white/40">Add items before placing a pickup order.</p>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-2 border-y border-white/8 py-5">
        <button
          type="button"
          onClick={onAddMoreItems}
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left text-sm font-black text-white/75 transition-all hover:bg-white/[0.04] hover:text-white"
        >
          <Plus className="h-5 w-5 text-[#FF4D2E]" />
          Add more items
        </button>
        <VoucherBox
          code={voucherCode}
          currency={summaryCurrency}
          appliedVoucher={appliedVoucher}
          discountAmount={voucherDiscount}
          error={voucherError}
          message={voucherMessage}
          disabled={cartItems.length === 0}
          onCodeChange={onVoucherCodeChange}
          onApply={onApplyVoucher}
          onRemove={onRemoveVoucher}
        />
      </div>

      <div className="mt-5 space-y-3 text-sm">
        <SummaryLine label="Subtotal" value={formatMoney(subtotal, summaryCurrency)} />
        <SummaryLine label="VAT" value={formatMoney(vat, summaryCurrency)} />
        <SummaryLine label="Service fee" value={formatMoney(serviceFee, summaryCurrency)} />
        {voucherDiscount > 0 && (
          <SummaryLine label="Voucher discount" value={`- ${formatMoney(voucherDiscount, summaryCurrency)}`} />
        )}
        <SummaryLine label="Payment method" value={paymentMethodLabel} />
        <div className="flex items-end justify-between gap-4 pt-3">
          <div>
            <p className="font-display text-2xl font-black text-white">Total</p>
            <p className="text-xs text-white/35">(incl. fees and tax)</p>
          </div>
          <p className="text-2xl font-black text-[#FF4D2E]">{formatMoney(total, summaryCurrency)}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onPlaceOrder}
        disabled={!canPlaceOrder}
        className="mt-6 h-12 w-full rounded-full bg-[#FF3B3B] text-sm font-black text-white transition-all hover:bg-[#ff5252] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
      >
        {placingOrder ? "Placing order..." : "Place pick-up order"}
      </button>

      {orderError && (
        <p className="mt-3 rounded-2xl border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 px-4 py-3 text-center text-xs font-bold text-[#FFB4AB]">
          {orderError}
        </p>
      )}

      {!canPlaceOrder && !placingOrder && (
        <p className="mt-3 text-center text-xs text-white/35">
          Add items and complete your personal details to place the order.
        </p>
      )}
    </section>
  );
}

function PaymentMethodButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[128px] flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
        active
          ? "border-[#FF3B3B]/45 bg-[#FF3B3B]/12 shadow-[0_18px_45px_rgba(255,59,59,0.12)]"
          : "border-white/10 bg-black/20 hover:border-[#FF3B3B]/30"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/30">
        <Icon className="h-5 w-5 text-[#FF4D2E]" />
      </span>
      <span>
        <span className="block text-sm font-black text-white">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-white/40">{description}</span>
      </span>
    </button>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-white/55">
      <span>{label}</span>
      <span className="font-bold text-white/80">{value}</span>
    </div>
  );
}

function getCartCurrency(items: CartItem[]) {
  return items.find((item) => item.currency === "PHP")?.currency || items.find((item) => item.currency)?.currency || "PHP";
}

function getPaymentMethodLabel(method: PickupPaymentMethod) {
  return PAYMENT_METHODS.find((option) => option.id === method)?.title || "Cash on Pickup";
}

function formatMoney(value: number, currency: CartCurrency = "PHP") {
  return formatCartMoney(value, currency);
}
