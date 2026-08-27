import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Banknote,
  Bike,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  Home,
  Mail,
  MapPin,
  Phone,
  Plus,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react";
import MapPicker from "@/components/MapPicker";
import Navbar from "@/components/navbar";
import { CustomizeModal, PRODUCTS } from "@/components/menu";
import VoucherBox from "@/components/voucher-box";
import { useAuth } from "@/context/auth-context";
import { auth, db } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  deleteUserAddress,
  getDefaultUserAddress,
  getUserAddresses,
  saveUserAddress,
  setDefaultUserAddress,
  updateUserAddress,
  type SavedAddress,
} from "@/lib/addresses";
import {
  buildCartItemSummary,
  formatCartMoney,
  type CartCurrency,
  type CartCustomization,
  type CartItem,
} from "@/lib/cart";
import { clearUserFirestoreCart, createOrder, type PaymentMethod } from "@/lib/orders";
import {
  calculateVoucherDiscount,
  hasUserRedeemedVoucher,
  validateVoucher,
  type AppliedVoucher,
} from "@/lib/vouchers";

interface DeliveryReviewPageProps {
  cartCount: number;
  cartItems: CartItem[];
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

interface PersonalDetails {
  email: string;
  firstName: string;
  lastName: string;
  mobile: string;
}

type DeliveryOption = "standard" | "priority";

type DeliveryPaymentMethod = Extract<PaymentMethod, "cash_on_delivery" | "xendit" | "paymongo">;

type LocationValue = {
  lat: number;
  lng: number;
};

const PAYMENT_METHODS: Array<{
  id: DeliveryPaymentMethod;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "cash_on_delivery",
    title: "Cash on Delivery",
    description: "Pay the rider when your order arrives.",
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

interface DeliveryAddressState {
  addressId?: string;
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  contactNumber: string;
  isDefault: boolean;
}

interface AddressFormState {
  addressId?: string;
  label: string;
  fullAddress: string;
  landmark: string;
  contactNumber: string;
  noteToRider: string;
  isDefault: boolean;
}

const EMPTY_DELIVERY_ADDRESS: DeliveryAddressState = {
  label: "Home",
  line1: "",
  line2: "",
  landmark: "",
  contactNumber: "",
  isDefault: false,
};

const EMPTY_ADDRESS_FORM: AddressFormState = {
  label: "Home",
  fullAddress: "",
  landmark: "",
  contactNumber: "",
  noteToRider: "",
  isDefault: true,
};

export default function DeliveryReviewPage({
  cartCount,
  cartItems,
  updateItem,
  removeItem,
  clearCart,
}: DeliveryReviewPageProps) {
  const { requireAuth, user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddressState>(EMPTY_DELIVERY_ADDRESS);
  const [deliveryLocation, setDeliveryLocation] = useState<LocationValue>({
    lat: 14.3036,
    lng: 121.0781,
  });
  const [noteToRider, setNoteToRider] = useState("");
  const [contactless, setContactless] = useState(true);
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>("standard");
  const [paymentMethod, setPaymentMethod] = useState<DeliveryPaymentMethod>("cash_on_delivery");
  const [personalDetails, setPersonalDetails] = useState<PersonalDetails>(EMPTY_DETAILS);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [addressSaved, setAddressSaved] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormState>(EMPTY_ADDRESS_FORM);
  const [addressFormError, setAddressFormError] = useState("");
  const [addressFormMessage, setAddressFormMessage] = useState("");
  const [tipAmount, setTipAmount] = useState(0);
  const [voucherCode, setVoucherCode] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<AppliedVoucher | null>(null);
  const [voucherError, setVoucherError] = useState("");
  const [voucherMessage, setVoucherMessage] = useState("");
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
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

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setDeliveryAddress(EMPTY_DELIVERY_ADDRESS);
      setSavedAddresses([]);
      setAddressSaved(false);
      setNoteToRider("");
      return () => {
        cancelled = true;
      };
    }

    setAddressesLoading(true);
    getDefaultUserAddress(user.uid)
      .then((address) => {
        if (cancelled) return;
        if (address) {
          const [line1, ...rest] = address.fullAddress.split("\n");

          setDeliveryAddress({
            addressId: address.addressId,
            label: address.label,
            line1: line1 || address.fullAddress,
            line2: rest.join("\n"),
            landmark: address.landmark,
            contactNumber: address.contactNumber,
            isDefault: address.isDefault,
          });
          setNoteToRider((note) => note || address.noteToRider);
          setAddressSaved(true);
        } else {
          setDeliveryAddress(EMPTY_DELIVERY_ADDRESS);
          setAddressSaved(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeliveryAddress(EMPTY_DELIVERY_ADDRESS);
          setAddressSaved(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAddressesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const totals = useMemo(() => {
    const subtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const deliveryFee = cartItems.length > 0 ? (deliveryOption === "priority" ? 89 : 59) : 0;
    const serviceFee = cartItems.length > 0 ? 15 : 0;
    const vat = 0;
    const voucherDiscount = appliedVoucher
      ? calculateVoucherDiscount(appliedVoucher, subtotal, deliveryFee, "delivery")
      : 0;
    const total = Math.max(0, subtotal + deliveryFee + serviceFee + vat + tipAmount - voucherDiscount);

    return { subtotal, deliveryFee, serviceFee, vat, tipAmount, voucherDiscount, total };
  }, [appliedVoucher, cartItems, deliveryOption, tipAmount]);

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

  const addressComplete =
    deliveryAddress.line1.trim().length > 0 ||
    deliveryAddress.line2.trim().length > 0;

  const canPlaceOrder = detailsComplete && addressComplete && cartItems.length > 0 && !placingOrder;

  const updateDetail = (field: keyof PersonalDetails, value: string) => {
    setPersonalDetails((details) => ({ ...details, [field]: value }));
    setDetailsSaved(false);
    setDetailsMessage("");
    setDetailsError("");
  };

  const updateAddress = (field: keyof DeliveryAddressState, value: string) => {
    setDeliveryAddress((address) => ({ ...address, [field]: value }));
    setAddressSaved(false);
    setAddressError("");
  };

  const applySavedAddressToCheckout = (address: SavedAddress) => {
    const [line1, ...rest] = address.fullAddress.split("\n");

    setDeliveryAddress({
      addressId: address.addressId,
      label: address.label,
      line1: line1 || address.fullAddress,
      line2: rest.join("\n"),
      landmark: address.landmark,
      contactNumber: address.contactNumber,
      isDefault: address.isDefault,
    });
    setNoteToRider(address.noteToRider);
    setAddressSaved(true);
    setAddressModalOpen(false);
  };

  const loadSavedAddresses = async (currentUserId: string) => {
    setAddressesLoading(true);
    setAddressFormError("");

    try {
      const addresses = await getUserAddresses(currentUserId);
      setSavedAddresses(addresses);
      return addresses;
    } catch {
      setAddressFormError("We couldn't load your saved addresses yet.");
      return [];
    } finally {
      setAddressesLoading(false);
    }
  };

  const openAddressModal = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      setAddressModalOpen(true);
      setAddressFormError("");
      setAddressFormMessage("");
      setAddressForm({
        addressId: deliveryAddress.addressId,
        label: deliveryAddress.label,
        fullAddress: [deliveryAddress.line1, deliveryAddress.line2].filter(Boolean).join("\n"),
        landmark: deliveryAddress.landmark,
        contactNumber: deliveryAddress.contactNumber || personalDetails.mobile,
        noteToRider,
        isDefault: deliveryAddress.isDefault,
      });
      await loadSavedAddresses(currentUser.uid);
    });
  };

  const editSavedAddress = (address: SavedAddress) => {
    setAddressForm({
      addressId: address.addressId,
      label: address.label,
      fullAddress: address.fullAddress,
      landmark: address.landmark,
      contactNumber: address.contactNumber,
      noteToRider: address.noteToRider,
      isDefault: address.isDefault,
    });
    setAddressFormError("");
    setAddressFormMessage("");
  };

  const resetAddressForm = () => {
    setAddressForm({
      ...EMPTY_ADDRESS_FORM,
      contactNumber: personalDetails.mobile,
      noteToRider,
    });
    setAddressFormError("");
    setAddressFormMessage("");
  };

  const saveAddressFromModal = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser || addressSaving) return;

      const fullAddress = addressForm.fullAddress.trim();
      const contactNumber = addressForm.contactNumber.trim() || personalDetails.mobile.trim();

      if (!fullAddress || !contactNumber) {
        setAddressFormError("Full address and contact number are required.");
        return;
      }

      setAddressSaving(true);
      setAddressFormError("");
      setAddressFormMessage("");

      try {
        const payload = {
          label: addressForm.label.trim() || "Home",
          fullAddress,
          landmark: addressForm.landmark.trim(),
          contactNumber,
          noteToRider: addressForm.noteToRider.trim(),
          isDefault: addressForm.isDefault,
        };

        const savedAddress = addressForm.addressId
          ? await updateUserAddress(currentUser.uid, addressForm.addressId, payload)
          : await saveUserAddress(currentUser.uid, payload);

        if (savedAddress.isDefault) {
          await setDefaultUserAddress(currentUser.uid, savedAddress.addressId);
        }

        const addresses = await loadSavedAddresses(currentUser.uid);
        const selectedAddress =
          addresses.find((address) => address.addressId === savedAddress.addressId) || savedAddress;

        applySavedAddressToCheckout(selectedAddress);
        setAddressFormMessage("Address saved and selected.");
      } catch {
        setAddressFormError("We couldn't save this address yet. Please try again.");
      } finally {
        setAddressSaving(false);
      }
    });
  };

  const deleteSavedAddress = (addressId: string) => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser || addressSaving) return;

      setAddressSaving(true);
      setAddressFormError("");
      setAddressFormMessage("");

      try {
        await deleteUserAddress(currentUser.uid, addressId);
        const addresses = await loadSavedAddresses(currentUser.uid);

        if (deliveryAddress.addressId === addressId) {
          const nextAddress = addresses.find((address) => address.isDefault) || addresses[0];
          if (nextAddress) {
            applySavedAddressToCheckout(nextAddress);
          } else {
            setDeliveryAddress(EMPTY_DELIVERY_ADDRESS);
            setAddressSaved(false);
          }
        }

        setAddressFormMessage("Address removed.");
      } catch {
        setAddressFormError("We couldn't delete this address yet.");
      } finally {
        setAddressSaving(false);
      }
    });
  };

  const makeDefaultAddress = (address: SavedAddress) => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser || addressSaving) return;

      setAddressSaving(true);
      setAddressFormError("");
      setAddressFormMessage("");

      try {
        await setDefaultUserAddress(currentUser.uid, address.addressId);
        const addresses = await loadSavedAddresses(currentUser.uid);
        const selectedAddress = addresses.find((item) => item.addressId === address.addressId) || {
          ...address,
          isDefault: true,
        };
        applySavedAddressToCheckout(selectedAddress);
        setAddressFormMessage("Default address updated.");
      } catch {
        setAddressFormError("We couldn't set this as default yet.");
      } finally {
        setAddressSaving(false);
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
        deliveryFee: totals.deliveryFee,
        orderType: "delivery",
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

  const handleSaveAddress = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;
      if (!currentUser || addressSaving) return;

      setAddressSaving(true);
      setAddressError("");

      try {
        const savedAddress = await saveUserAddress(currentUser.uid, {
          addressId: deliveryAddress.addressId,
          label: deliveryAddress.label.trim() || "Home",
          fullAddress: [deliveryAddress.line1.trim(), deliveryAddress.line2.trim()].filter(Boolean).join("\n"),
          landmark: deliveryAddress.landmark.trim(),
          contactNumber: personalDetails.mobile.trim() || deliveryAddress.contactNumber.trim(),
          noteToRider: noteToRider.trim(),
          isDefault: true,
        });

        setDeliveryAddress((address) => ({
          ...address,
          addressId: savedAddress.addressId,
          contactNumber: savedAddress.contactNumber,
          isDefault: savedAddress.isDefault,
        }));
        setAddressSaved(true);
      } catch {
        setAddressError("We couldn't save this address yet. Please try again.");
      } finally {
        setAddressSaving(false);
      }
    });
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

  const addMoreItems = () => {
    setLocation("/");
    window.setTimeout(() => {
      document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handlePlaceOrder = () => {
    requireAuth(async () => {
      const currentUser = auth.currentUser;

      if (!currentUser || cartItems.length === 0 || !detailsComplete || placingOrder) return;

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
          orderType: "delivery",
          delivery: {
            address: {
              addressId: deliveryAddress.addressId,
              label: deliveryAddress.label,
              fullAddress: [deliveryAddress.line1, deliveryAddress.line2].filter(Boolean).join("\n"),
              landmark: deliveryAddress.landmark,
              contactNumber: personalDetails.mobile || deliveryAddress.contactNumber,
              isDefault: deliveryAddress.isDefault,
              location: {
                lat: deliveryLocation.lat,
                lng: deliveryLocation.lng,
              },
            },
            noteToRider: noteToRider.trim(),
            contactless,
            option: deliveryOption,
            estimatedTime: deliveryOption === "standard" ? "25-35 mins" : "20-30 mins",
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
      } catch (error) {
        setOrderError(error instanceof Error ? error.message : "We couldn't place your order yet. Please check your connection and try again.");
      } finally {
        setPlacingOrder(false);
      }
    });
  };

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#050505] text-white">
      <Navbar cartCount={cartCount} showSearch={false} />

      <main className="pb-16 pt-24 md:pt-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FF8A80]">
                Delivery checkout
              </p>
              <h1 className="mt-2 font-display text-3xl font-black leading-tight sm:text-4xl md:text-5xl">
                Review and place your order
              </h1>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 px-4 py-2 text-sm font-bold text-[#FFB4AB]">
              <Truck className="h-4 w-4" />
              Delivery: {deliveryOption === "standard" ? "25-35 mins" : "20-30 mins"}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0 space-y-6">
              <ReviewCard>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                      Delivery address
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
                      {deliveryAddress.label}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={openAddressModal}
                    className="h-10 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-white/65 transition-all hover:border-[#FF3B3B]/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Change address
                  </button>
                </div>

                <div className="grid gap-4">
                  <Field
                    icon={Home}
                    label="Address label"
                    value={deliveryAddress.label}
                    onChange={(value) => updateAddress("label", value)}
                    placeholder="Home, Work, School"
                  />
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                      Full address
                    </span>
                    <textarea
                      value={[deliveryAddress.line1, deliveryAddress.line2].filter(Boolean).join("\n")}
                      onChange={(event) => {
                        const [line1, ...rest] = event.target.value.split("\n");
                        setDeliveryAddress((address) => ({
                          ...address,
                          line1,
                          line2: rest.join("\n"),
                        }));
                        setAddressSaved(false);
                      }}
                      placeholder="House/building, street, barangay, city"
                      className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                    />
                  </label>
                  <Field
                    icon={MapPin}
                    label="Landmark"
                    value={deliveryAddress.landmark}
                    onChange={(value) => updateAddress("landmark", value)}
                    placeholder="Nearby landmark, gate, or building"
                  />
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">
                        Pin delivery location
                      </p>
                      <p className="mt-1 text-sm text-white/40">
                        Use your current location or drag the pin to your exact delivery spot.
                      </p>
                    </div>

                    <MapPicker
                      value={deliveryLocation}
                      onChange={(location) => {
                        setDeliveryLocation(location);
                        setAddressSaved(false);
                      }}
                    />
                  </div>
                </div>

                {addressError && (
                  <p className="mt-3 rounded-2xl border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 px-4 py-3 text-xs font-bold text-[#FFB4AB]">
                    {addressError}
                  </p>
                )}

                <label className="mt-4 block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                    Note to rider
                  </span>
                  <textarea
                    value={noteToRider}
                    onChange={(event) => setNoteToRider(event.target.value)}
                    placeholder="e.g. building, landmark, gate instruction"
                    className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSaveAddress}
                  disabled={addressSaving}
                  className="mt-4 h-11 rounded-full border border-[#FF3B3B]/30 bg-[#FF3B3B]/10 px-5 text-sm font-black text-white transition-all hover:bg-[#FF3B3B]/18 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addressSaving ? "Saving address..." : addressSaved ? "Address saved" : "Save address"}
                </button>

                <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/8 pt-4">
                  <div>
                    <p className="font-black">Contactless delivery</p>
                    <p className="mt-1 text-xs text-white/40">
                      Rider leaves the order at your door after confirming arrival.
                    </p>
                  </div>
                  <Toggle checked={contactless} onClick={() => setContactless((value) => !value)} />
                </div>
              </ReviewCard>

              <ReviewCard>
                <div className="mb-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                    Delivery options
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
                    Choose delivery speed
                  </h2>
                </div>

                <div className="space-y-3">
                  <DeliveryOptionButton
                    active={deliveryOption === "standard"}
                    icon={Truck}
                    title="Standard"
                    time="25-35 mins"
                    price="Included"
                    onClick={() => setDeliveryOption("standard")}
                  />
                  <DeliveryOptionButton
                    active={deliveryOption === "priority"}
                    icon={Bike}
                    title="Priority"
                    time="20-30 mins"
                    price={`+ ${formatCartMoney(30)}`}
                    onClick={() => setDeliveryOption("priority")}
                  />
                </div>
              </ReviewCard>

              <ReviewCard>
                <div className="mb-5">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                    Mode of payment
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
                    Choose how to pay
                  </h2>
                  <p className="mt-2 text-sm text-white/40">
                    Your selected payment mode will be saved with this delivery order.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
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
                    <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
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

              <ReviewCard>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                  Tip your rider
                </p>
                <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
                  Rider appreciation
                </h2>
                <p className="mt-2 text-sm text-white/45">
                  100% of the tip goes to your rider.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {[0, 5, 20, 40, 60].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setTipAmount(amount)}
                      className={`h-10 rounded-full border px-4 text-sm font-black transition-all ${
                        tipAmount === amount
                          ? "border-[#FF3B3B]/55 bg-[#FF3B3B]/15 text-white"
                          : "border-white/10 bg-black/20 text-white/55 hover:border-[#FF3B3B]/35 hover:text-white"
                      }`}
                    >
                      {amount === 0 ? "Not now" : formatCartMoney(amount)}
                    </button>
                  ))}
                </div>
              </ReviewCard>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-24 lg:h-fit">
              <OrderSummary
                cartItems={cartItems}
                subtotal={totals.subtotal}
                deliveryFee={totals.deliveryFee}
                serviceFee={totals.serviceFee}
                vat={totals.vat}
                tipAmount={tipAmount}
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
                onAddMoreItems={addMoreItems}
                onEditItem={(item) => requireAuth(() => setEditingItem(item))}
                onRemoveItem={removeItem}
                onPlaceOrder={handlePlaceOrder}
                placingOrder={placingOrder}
                orderError={orderError}
              />
            </aside>
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
          currency="PHP"
        />
      )}

      {addressModalOpen && (
        <AddressModal
          addresses={savedAddresses}
          selectedAddressId={deliveryAddress.addressId}
          loading={addressesLoading}
          saving={addressSaving}
          form={addressForm}
          error={addressFormError}
          message={addressFormMessage}
          onClose={() => setAddressModalOpen(false)}
          onSelect={applySavedAddressToCheckout}
          onEdit={editSavedAddress}
          onDelete={deleteSavedAddress}
          onSetDefault={makeDefaultAddress}
          onNew={resetAddressForm}
          onFormChange={(updates) => {
            setAddressForm((form) => ({ ...form, ...updates }));
            setAddressFormError("");
            setAddressFormMessage("");
          }}
          onSave={saveAddressFromModal}
        />
      )}

    </div>
  );
}

function AddressModal({
  addresses,
  selectedAddressId,
  loading,
  saving,
  form,
  error,
  message,
  onClose,
  onSelect,
  onEdit,
  onDelete,
  onSetDefault,
  onNew,
  onFormChange,
  onSave,
}: {
  addresses: SavedAddress[];
  selectedAddressId?: string;
  loading: boolean;
  saving: boolean;
  form: AddressFormState;
  error: string;
  message: string;
  onClose: () => void;
  onSelect: (address: SavedAddress) => void;
  onEdit: (address: SavedAddress) => void;
  onDelete: (addressId: string) => void;
  onSetDefault: (address: SavedAddress) => void;
  onNew: () => void;
  onFormChange: (updates: Partial<AddressFormState>) => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 px-4 py-4 backdrop-blur-sm sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-[#111111] shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/8 p-5 sm:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FF8A80]">
              Delivery address
            </p>
            <h2 className="mt-2 font-display text-2xl font-black text-white">
              Change address
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:border-[#FF3B3B]/35 hover:text-white"
            aria-label="Close address modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bunbite-scrollbar max-h-[calc(92dvh-96px)] overflow-y-auto p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-sm font-black text-white/75">Saved addresses</p>
            <button
              type="button"
              onClick={onNew}
              className="h-9 rounded-full border border-[#FF3B3B]/30 bg-[#FF3B3B]/10 px-4 text-xs font-black text-white transition-all hover:bg-[#FF3B3B]/18"
            >
              Add new
            </button>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center text-sm font-bold text-white/45">
              Loading saved addresses...
            </div>
          ) : addresses.length > 0 ? (
            <div className="grid gap-3">
              {addresses.map((address) => (
                <div
                  key={address.addressId}
                  className={`rounded-2xl border p-4 ${
                    selectedAddressId === address.addressId
                      ? "border-[#FF3B3B]/45 bg-[#FF3B3B]/10"
                      : "border-white/10 bg-black/20"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black text-white">{address.label}</p>
                        {address.isDefault && (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-black text-emerald-200">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/55">
                        {address.fullAddress}
                      </p>
                      {address.landmark && (
                        <p className="mt-1 text-xs text-white/35">Landmark: {address.landmark}</p>
                      )}
                      <p className="mt-1 text-xs text-white/35">Contact: {address.contactNumber}</p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => onSelect(address)}
                        className="h-9 rounded-full bg-[#FF3B3B] px-4 text-xs font-black text-white transition-all hover:bg-[#ff5252]"
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(address)}
                        className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white/65 transition-all hover:border-[#FF3B3B]/35 hover:text-white"
                      >
                        Edit
                      </button>
                      {!address.isDefault && (
                        <button
                          type="button"
                          onClick={() => onSetDefault(address)}
                          className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white/65 transition-all hover:border-[#FF3B3B]/35 hover:text-white"
                        >
                          Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Remove this saved address?")) onDelete(address.addressId);
                        }}
                        className="h-9 rounded-full border border-[#FF3B3B]/25 bg-[#FF3B3B]/10 px-4 text-xs font-black text-[#FFB4AB] transition-all hover:border-[#FF3B3B]/45 hover:text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
              <p className="font-black text-white">No saved addresses yet.</p>
              <p className="mt-1 text-sm text-white/40">Add one below and use it for delivery checkout.</p>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">
                {form.addressId ? "Edit address" : "Add address"}
              </p>
              <p className="mt-1 text-sm text-white/45">
                Saved addresses are private to your account.
              </p>
            </div>

            <div className="grid gap-4">
              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                  Label
                </span>
                <input
                  value={form.label}
                  onChange={(event) => onFormChange({ label: event.target.value })}
                  placeholder="Home, School, Work"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                  Full address
                </span>
                <textarea
                  value={form.fullAddress}
                  onChange={(event) => onFormChange({ fullAddress: event.target.value })}
                  placeholder="House/building, street, barangay, city"
                  className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                    Landmark
                  </span>
                  <input
                    value={form.landmark}
                    onChange={(event) => onFormChange({ landmark: event.target.value })}
                    placeholder="Nearby landmark"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                    Contact number
                  </span>
                  <input
                    value={form.contactNumber}
                    onChange={(event) => onFormChange({ contactNumber: event.target.value })}
                    placeholder="+63 9XX XXX XXXX"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-white/35">
                  Note to rider
                </span>
                <textarea
                  value={form.noteToRider}
                  onChange={(event) => onFormChange({ noteToRider: event.target.value })}
                  placeholder="Gate, building, or rider instruction"
                  className="min-h-[90px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FF3B3B]/45"
                />
              </label>

              <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <span>
                  <span className="block font-black text-white">Set as default</span>
                  <span className="text-xs text-white/35">Use this address first during delivery checkout.</span>
                </span>
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(event) => onFormChange({ isDefault: event.target.checked })}
                  className="h-5 w-5 accent-[#FF3B3B]"
                />
              </label>
            </div>

            {(error || message) && (
              <p className={`mt-4 rounded-2xl border px-4 py-3 text-xs font-bold ${
                error
                  ? "border-[#FF3B3B]/25 bg-[#FF3B3B]/10 text-[#FFB4AB]"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
              }`}>
                {error || message}
              </p>
            )}

            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="mt-5 h-12 w-full rounded-full bg-[#FF3B3B] text-sm font-black text-white transition-all hover:bg-[#ff5252] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              {saving ? "Saving address..." : form.addressId ? "Save changes" : "Save address"}
            </button>
          </div>
        </div>
      </div>
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

function DeliveryOptionButton({
  active,
  icon: Icon,
  title,
  time,
  price,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  time: string;
  price: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-all ${
        active
          ? "border-[#FF3B3B]/40 bg-[#FF3B3B]/12"
          : "border-white/10 bg-black/20 hover:border-[#FF3B3B]/30"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25">
          <Icon className="h-5 w-5 text-[#FF4D2E]" />
        </span>
        <span className="min-w-0">
          <span className="block font-black text-white">{title}</span>
          <span className="block text-sm text-white/45">{time}</span>
        </span>
      </div>
      <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-sm font-black text-[#FFB4AB]">
        {price}
      </span>
    </button>
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

function Toggle({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-all ${
        checked ? "border-[#FF3B3B]/50 bg-[#FF3B3B]" : "border-white/10 bg-white/20"
      }`}
    >
      <span
        className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function OrderSummary({
  cartItems,
  subtotal,
  deliveryFee,
  serviceFee,
  vat,
  tipAmount,
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
  cartItems: CartItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  vat: number;
  tipAmount: number;
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
        <h2 className="mt-2 font-display text-2xl font-black leading-tight">
          Bun & Bite Delivery Kitchen
        </h2>
      </div>

      <div className="space-y-3">
        {cartItems.length > 0 ? (
          cartItems.map((item) => (
            <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] gap-3 rounded-2xl bg-black/20 p-2.5">
              <img src={item.image} alt={item.name} className="h-11 w-11 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{item.quantity} x {item.name}</p>
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
            <p className="font-black">Your order is empty.</p>
            <p className="mt-1 text-sm text-white/40">Add items before checkout.</p>
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
        <SummaryLine label="Delivery fee" value={formatMoney(deliveryFee, summaryCurrency)} />
        <SummaryLine label="Service fee" value={formatMoney(serviceFee, summaryCurrency)} />
        <SummaryLine label="VAT" value={formatMoney(vat, summaryCurrency)} />
        {tipAmount > 0 && <SummaryLine label="Rider tip" value={formatMoney(tipAmount, summaryCurrency)} />}
        {voucherDiscount > 0 && (
          <SummaryLine label="Voucher discount" value={`- ${formatMoney(voucherDiscount, summaryCurrency)}`} />
        )}
        <SummaryLine label="Payment method" value={paymentMethodLabel} />
        <div className="flex items-end justify-between gap-4 pt-3">
          <div>
            <p className="font-display text-2xl font-black">Total</p>
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
        {placingOrder ? "Placing order..." : "Place order"}
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
      className={`flex min-h-[132px] flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
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
  return items.find((item) => item.currency)?.currency || "PHP";
}

function getPaymentMethodLabel(method: DeliveryPaymentMethod) {
  return PAYMENT_METHODS.find((option) => option.id === method)?.title || "Cash on Delivery";
}

function formatMoney(value: number, currency: CartCurrency = "PHP") {
  return formatCartMoney(value, currency);
}
