-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Required for case-insensitive user email, coupon, and referral identifiers.
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('SUPABASE', 'IMPORTED');

-- CreateEnum
CREATE TYPE "public"."PlatformRole" AS ENUM ('SUPPORT_ADMIN', 'CONTENT_ADMIN', 'OPERATIONS_ADMIN', 'SOURCING_MANAGER', 'FINANCE_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "public"."StoreStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."StoreRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'PRODUCT_MANAGER', 'ORDER_MANAGER', 'FINANCE_MANAGER', 'SUPPORT_AGENT');

-- CreateEnum
CREATE TYPE "public"."StorePermission" AS ENUM ('STORE_READ', 'STORE_UPDATE', 'PRODUCT_READ', 'PRODUCT_WRITE', 'INVENTORY_WRITE', 'ORDER_READ', 'ORDER_FULFIL', 'CUSTOMER_READ', 'MESSAGE_WRITE', 'FINANCE_READ', 'PAYOUT_REQUEST', 'STAFF_MANAGE', 'AD_MANAGE');

-- CreateEnum
CREATE TYPE "public"."SupplierStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."ProductCondition" AS ENUM ('NEW', 'USED', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "public"."MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "public"."MediaAccess" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."QuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PROCESSING', 'READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'DISPUTED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."PaymentAttemptStatus" AS ENUM ('CREATED', 'INITIALIZED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."InventoryMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'RESERVE', 'RELEASE', 'SALE_COMMIT', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."LedgerEntryType" AS ENUM ('SALE_CREDIT', 'COMMISSION_DEBIT', 'REFUND_DEBIT', 'PAYOUT_HOLD', 'PAYOUT_DEBIT', 'PAYOUT_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."PayoutStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ConversationType" AS ENUM ('DIRECT', 'ORDER', 'SOURCING', 'SUPPORT');

-- CreateEnum
CREATE TYPE "public"."MessageType" AS ENUM ('TEXT', 'IMAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "public"."KycSubjectType" AS ENUM ('USER', 'STORE', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "public"."KycStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_BUYER', 'AWAITING_SELLER', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."AdStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."AdEventType" AS ENUM ('IMPRESSION', 'CLICK');

-- CreateEnum
CREATE TYPE "public"."SourcingStatus" AS ENUM ('DRAFT', 'REQUEST_SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'QUOTE_READY', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'PROCUREMENT_IN_PROGRESS', 'PROCURED', 'INTERNATIONAL_TRANSIT', 'ARRIVED_IN_COUNTRY', 'LOCAL_FULFILMENT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SourcePlatform" AS ENUM ('INTERNAL_SUPPLIER', 'DIRECT_FACTORY', 'EXTERNAL_MARKETPLACE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ServiceBookingStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RfqStatus" AS ENUM ('DRAFT', 'OPEN', 'QUOTING', 'AWARDED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserProfile" (
    "userId" UUID NOT NULL,
    "displayName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "avatarId" UUID,
    "location" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."AuthIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "providerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformRoleAssignment" (
    "userId" UUID NOT NULL,
    "role" "public"."PlatformRole" NOT NULL,
    "grantedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRoleAssignment_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "public"."Store" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."StoreStatus" NOT NULL DEFAULT 'PENDING',
    "logoAssetId" UUID,
    "bannerAssetId" UUID,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "location" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreSetting" (
    "storeId" UUID NOT NULL,
    "notificationPreferences" JSONB NOT NULL DEFAULT '{}',
    "commerceSettings" JSONB NOT NULL DEFAULT '{}',
    "fulfilmentSettings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "public"."StoreMembership" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "public"."StoreRole" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreMembershipPermission" (
    "membershipId" UUID NOT NULL,
    "permission" "public"."StorePermission" NOT NULL,

    CONSTRAINT "StoreMembershipPermission_pkey" PRIMARY KEY ("membershipId","permission")
);

-- CreateTable
CREATE TABLE "public"."SupplierProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."SupplierStatus" NOT NULL DEFAULT 'PENDING',
    "country" TEXT,
    "contactEmail" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierConnection" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierProduct" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "costKobo" BIGINT NOT NULL,
    "suggestedKobo" BIGINT,
    "stockQuantity" INTEGER,
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Brand" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoAssetId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "categoryId" UUID,
    "brandId" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" "public"."ProductCondition" NOT NULL DEFAULT 'NEW',
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "shippingFeeKobo" BIGINT NOT NULL DEFAULT 0,
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductOption" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductOptionValue" (
    "id" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductVariantOptionValue" (
    "variantId" UUID NOT NULL,
    "valueId" UUID NOT NULL,

    CONSTRAINT "ProductVariantOptionValue_pkey" PRIMARY KEY ("variantId","valueId")
);

-- CreateTable
CREATE TABLE "public"."ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT,
    "priceKobo" BIGINT NOT NULL,
    "compareAtKobo" BIGINT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryItem" (
    "variantId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "public"."InventoryReservation" (
    "id" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryMovement" (
    "id" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "type" "public"."InventoryMovementType" NOT NULL,
    "onHandDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MediaAsset" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAssetId" TEXT NOT NULL,
    "kind" "public"."MediaKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "access" "public"."MediaAccess" NOT NULL,
    "publicUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductMedia" (
    "productId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("productId","assetId")
);

-- CreateTable
CREATE TABLE "public"."Address" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Cart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Wishlist" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Saved items',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WishlistItem" (
    "wishlistId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("wishlistId","productId")
);

-- CreateTable
CREATE TABLE "public"."CheckoutQuote" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addressId" UUID NOT NULL,
    "status" "public"."QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotalKobo" BIGINT NOT NULL,
    "shippingKobo" BIGINT NOT NULL,
    "discountKobo" BIGINT NOT NULL DEFAULT 0,
    "platformFeeKobo" BIGINT NOT NULL DEFAULT 0,
    "totalKobo" BIGINT NOT NULL,
    "couponId" UUID,
    "deliveryMethod" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CheckoutQuoteItem" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "sku" TEXT NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "shippingUnitKobo" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CheckoutQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "buyerId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotalKobo" BIGINT NOT NULL,
    "shippingKobo" BIGINT NOT NULL,
    "discountKobo" BIGINT NOT NULL DEFAULT 0,
    "platformFeeKobo" BIGINT NOT NULL DEFAULT 0,
    "totalKobo" BIGINT NOT NULL,
    "deliveryMethod" TEXT NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StoreOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "subtotalKobo" BIGINT NOT NULL,
    "shippingKobo" BIGINT NOT NULL,
    "discountKobo" BIGINT NOT NULL DEFAULT 0,
    "platformFeeKobo" BIGINT NOT NULL DEFAULT 0,
    "commissionKobo" BIGINT NOT NULL DEFAULT 0,
    "sellerNetKobo" BIGINT NOT NULL DEFAULT 0,
    "totalKobo" BIGINT NOT NULL,
    "trackingNumber" TEXT,
    "trackingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "sku" TEXT NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "shippingUnitKobo" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "sellerAmountKobo" BIGINT NOT NULL,
    "platformCommissionKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderStatusEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "public"."OrderStatus",
    "toStatus" "public"."OrderStatus" NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Coupon" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "percentOffBps" INTEGER,
    "fixedOffKobo" BIGINT,
    "minimumKobo" BIGINT NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CouponRedemption" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "discountKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "internalReference" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentAttempt" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "internalRef" TEXT NOT NULL,
    "status" "public"."PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "providerPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerAccount" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerEntry" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "storeOrderId" UUID,
    "type" "public"."LedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayoutDestination" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayoutRequest" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "public"."PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "decisionReason" TEXT,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayoutTransaction" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "public"."PayoutStatus" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" UUID NOT NULL,
    "type" "public"."ConversationType" NOT NULL,
    "orderId" UUID,
    "sourcingRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConversationMember" (
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "type" "public"."MessageType" NOT NULL DEFAULT 'TEXT',
    "mediaAssetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Review" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "status" "public"."ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationPreference" (
    "userId" UUID NOT NULL,
    "emailOrderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "pushMessages" BOOLEAN NOT NULL DEFAULT true,
    "marketingEmail" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "provider" TEXT,
    "deviceMeta" JSONB NOT NULL DEFAULT '{}',
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KycSubmission" (
    "id" UUID NOT NULL,
    "subjectType" "public"."KycSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "submittedById" UUID NOT NULL,
    "status" "public"."KycStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KycDocument" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Dispute" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DisputeMessage" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DisputeEvidence" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdCampaign" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "destinationUrl" TEXT NOT NULL,
    "mediaAssetId" UUID,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" "public"."AdStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "paymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdEvent" (
    "id" BIGSERIAL NOT NULL,
    "campaignId" UUID NOT NULL,
    "type" "public"."AdEventType" NOT NULL,
    "userId" UUID,
    "anonymousId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcingRequest" (
    "id" UUID NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "assignedAdminId" UUID,
    "status" "public"."SourcingStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "deliveryLocation" TEXT,
    "desiredDeliveryAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcingItem" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "specifications" JSONB NOT NULL DEFAULT '{}',
    "quantity" INTEGER NOT NULL,
    "referenceUrl" TEXT,
    "imageAssetId" UUID,
    "targetBudgetKobo" BIGINT,
    "quotedUnitKobo" BIGINT,

    CONSTRAINT "SourcingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcingQuote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "subtotalKobo" BIGINT NOT NULL,
    "serviceKobo" BIGINT NOT NULL,
    "shippingKobo" BIGINT NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "estimatedDeliveryAt" TIMESTAMP(3),
    "terms" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcingProcurement" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "sourcePlatform" "public"."SourcePlatform" NOT NULL,
    "providerCode" TEXT,
    "sourceUrl" TEXT,
    "supplierId" UUID,
    "supplierReference" TEXT,
    "supplierProductId" TEXT,
    "supplierOrderId" TEXT,
    "sourceCurrency" TEXT,
    "sourceUnitCostMinor" BIGINT,
    "sourceShippingMinor" BIGINT,
    "exchangeRate" DECIMAL(18,8),
    "internationalShippingKobo" BIGINT,
    "localDeliveryKobo" BIGINT,
    "internalStatus" TEXT,
    "procurementNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingProcurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourcingStatusHistory" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "from" "public"."SourcingStatus",
    "to" "public"."SourcingStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RfqRequest" (
    "id" UUID NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "specifications" JSONB NOT NULL DEFAULT '{}',
    "quantity" INTEGER NOT NULL,
    "targetBudgetKobo" BIGINT,
    "deliveryLocation" TEXT,
    "responseDeadline" TIMESTAMP(3),
    "status" "public"."RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "awardedQuoteId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RfqRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RfqQuote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "unitPriceKobo" BIGINT NOT NULL,
    "shippingKobo" BIGINT NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL,
    "minimumOrderQty" INTEGER NOT NULL DEFAULT 1,
    "terms" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfqQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceListing" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "startingKobo" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "coverAssetId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceBooking" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "public"."ServiceBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "agreedKobo" BIGINT,
    "scheduledFor" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FulfilmentHub" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfilmentHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryAssignment" (
    "id" UUID NOT NULL,
    "storeOrderId" UUID NOT NULL,
    "riderId" UUID,
    "hubId" UUID,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
    "trackingCode" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "proofMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BroadcastCampaign" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "content" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" "public"."BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BroadcastDelivery" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "errorCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReferralCode" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReferralVisit" (
    "id" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "visitorId" UUID,
    "anonymousId" TEXT,
    "landingPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReferralConversion" (
    "id" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "productId" UUID,
    "orderId" UUID NOT NULL,
    "earningKobo" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SiteSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OutboxEvent" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "public"."AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "public"."AuthIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "public"."Store"("slug");

-- CreateIndex
CREATE INDEX "Store_status_createdAt_idx" ON "public"."Store"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StoreMembership_userId_status_idx" ON "public"."StoreMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMembership_storeId_userId_key" ON "public"."StoreMembership"("storeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_userId_key" ON "public"."SupplierProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_slug_key" ON "public"."SupplierProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierConnection_supplierId_storeId_key" ON "public"."SupplierConnection"("supplierId", "storeId");

-- CreateIndex
CREATE INDEX "SupplierProduct_supplierId_active_idx" ON "public"."SupplierProduct"("supplierId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_sku_key" ON "public"."SupplierProduct"("supplierId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "public"."Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_active_sortOrder_idx" ON "public"."Category"("parentId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "public"."Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "public"."Brand"("name");

-- CreateIndex
CREATE INDEX "Brand_active_name_idx" ON "public"."Brand"("active", "name");

-- CreateIndex
CREATE INDEX "Product_status_categoryId_createdAt_idx" ON "public"."Product"("status", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_brandId_status_idx" ON "public"."Product"("brandId", "status");

-- CreateIndex
CREATE INDEX "Product_storeId_status_idx" ON "public"."Product"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_slug_key" ON "public"."Product"("storeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "public"."ProductOption"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionValue_optionId_value_key" ON "public"."ProductOptionValue"("optionId", "value");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_active_idx" ON "public"."ProductVariant"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "public"."ProductVariant"("productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_orderItemId_key" ON "public"."InventoryReservation"("orderItemId");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "public"."InventoryReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderId_idx" ON "public"."InventoryReservation"("orderId");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryId_createdAt_idx" ON "public"."InventoryMovement"("inventoryId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx" ON "public"."InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_providerAssetId_key" ON "public"."MediaAsset"("providerAssetId");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerId_access_idx" ON "public"."MediaAsset"("ownerId", "access");

-- CreateIndex
CREATE INDEX "ProductMedia_productId_sortOrder_idx" ON "public"."ProductMedia"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "Address_userId_isDefault_idx" ON "public"."Address"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "public"."Cart"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "public"."CartItem"("cartId", "variantId");

-- CreateIndex
CREATE INDEX "Wishlist_userId_isDefault_idx" ON "public"."Wishlist"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_userId_name_key" ON "public"."Wishlist"("userId", "name");

-- CreateIndex
CREATE INDEX "WishlistItem_productId_idx" ON "public"."WishlistItem"("productId");

-- CreateIndex
CREATE INDEX "CheckoutQuote_userId_status_expiresAt_idx" ON "public"."CheckoutQuote"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutQuoteItem_storeId_idx" ON "public"."CheckoutQuoteItem"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutQuoteItem_quoteId_variantId_key" ON "public"."CheckoutQuoteItem"("quoteId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "public"."Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "public"."Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "public"."Order"("quoteId");

-- CreateIndex
CREATE INDEX "Order_buyerId_createdAt_idx" ON "public"."Order"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "public"."Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StoreOrder_storeId_status_createdAt_idx" ON "public"."StoreOrder"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_orderId_storeId_key" ON "public"."StoreOrder"("orderId", "storeId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "public"."OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_storeOrderId_idx" ON "public"."OrderItem"("storeOrderId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "public"."OrderStatusEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Coupon_code_active_idx" ON "public"."Coupon"("code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_storeId_code_key" ON "public"."Coupon"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "public"."CouponRedemption"("orderId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_userId_idx" ON "public"."CouponRedemption"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_internalReference_key" ON "public"."Payment"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "public"."Payment"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTransactionId_key" ON "public"."Payment"("providerTransactionId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "public"."Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_internalRef_key" ON "public"."PaymentAttempt"("internalRef");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_status_createdAt_idx" ON "public"."PaymentWebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "public"."PaymentWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_storeId_key" ON "public"."LedgerAccount"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "public"."LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_availableAt_createdAt_idx" ON "public"."LedgerEntry"("accountId", "availableAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutDestination_storeId_fingerprint_key" ON "public"."PayoutDestination"("storeId", "fingerprint");

-- CreateIndex
CREATE INDEX "PayoutRequest_accountId_status_createdAt_idx" ON "public"."PayoutRequest"("accountId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransaction_providerReference_key" ON "public"."PayoutTransaction"("providerReference");

-- CreateIndex
CREATE INDEX "Conversation_orderId_idx" ON "public"."Conversation"("orderId");

-- CreateIndex
CREATE INDEX "Conversation_sourcingRequestId_idx" ON "public"."Conversation"("sourcingRequestId");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_joinedAt_idx" ON "public"."ConversationMember"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "public"."Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderItemId_key" ON "public"."Review"("orderItemId");

-- CreateIndex
CREATE INDEX "Review_productId_status_createdAt_idx" ON "public"."Review"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "public"."Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key" ON "public"."PushSubscription"("userId", "endpoint");

-- CreateIndex
CREATE INDEX "KycSubmission_subjectType_subjectId_status_idx" ON "public"."KycSubmission"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_submissionId_documentType_mediaAssetId_key" ON "public"."KycDocument"("submissionId", "documentType", "mediaAssetId");

-- CreateIndex
CREATE INDEX "Dispute_orderId_status_idx" ON "public"."Dispute"("orderId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "public"."Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeMessage_disputeId_createdAt_idx" ON "public"."DisputeMessage"("disputeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeEvidence_disputeId_mediaAssetId_key" ON "public"."DisputeEvidence"("disputeId", "mediaAssetId");

-- CreateIndex
CREATE INDEX "AdCampaign_status_placement_startsAt_endsAt_idx" ON "public"."AdCampaign"("status", "placement", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "AdEvent_campaignId_type_createdAt_idx" ON "public"."AdEvent"("campaignId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingRequest_requestNumber_key" ON "public"."SourcingRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "SourcingRequest_requesterId_createdAt_idx" ON "public"."SourcingRequest"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "SourcingRequest_status_createdAt_idx" ON "public"."SourcingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SourcingItem_requestId_idx" ON "public"."SourcingItem"("requestId");

-- CreateIndex
CREATE INDEX "SourcingQuote_requestId_createdAt_idx" ON "public"."SourcingQuote"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingProcurement_requestId_key" ON "public"."SourcingProcurement"("requestId");

-- CreateIndex
CREATE INDEX "SourcingProcurement_sourcePlatform_internalStatus_idx" ON "public"."SourcingProcurement"("sourcePlatform", "internalStatus");

-- CreateIndex
CREATE INDEX "SourcingProcurement_supplierId_idx" ON "public"."SourcingProcurement"("supplierId");

-- CreateIndex
CREATE INDEX "SourcingStatusHistory_requestId_createdAt_idx" ON "public"."SourcingStatusHistory"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RfqRequest_requestNumber_key" ON "public"."RfqRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RfqRequest_awardedQuoteId_key" ON "public"."RfqRequest"("awardedQuoteId");

-- CreateIndex
CREATE INDEX "RfqRequest_status_createdAt_idx" ON "public"."RfqRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RfqRequest_requesterId_createdAt_idx" ON "public"."RfqRequest"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "RfqQuote_supplierId_createdAt_idx" ON "public"."RfqQuote"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RfqQuote_requestId_supplierId_key" ON "public"."RfqQuote"("requestId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceListing_slug_key" ON "public"."ServiceListing"("slug");

-- CreateIndex
CREATE INDEX "ServiceListing_active_category_createdAt_idx" ON "public"."ServiceListing"("active", "category", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceListing_providerId_active_idx" ON "public"."ServiceListing"("providerId", "active");

-- CreateIndex
CREATE INDEX "ServiceBooking_customerId_status_createdAt_idx" ON "public"."ServiceBooking"("customerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceBooking_listingId_status_idx" ON "public"."ServiceBooking"("listingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FulfilmentHub_slug_key" ON "public"."FulfilmentHub"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAssignment_storeOrderId_key" ON "public"."DeliveryAssignment"("storeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAssignment_trackingCode_key" ON "public"."DeliveryAssignment"("trackingCode");

-- CreateIndex
CREATE INDEX "DeliveryAssignment_riderId_status_createdAt_idx" ON "public"."DeliveryAssignment"("riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAssignment_hubId_status_idx" ON "public"."DeliveryAssignment"("hubId", "status");

-- CreateIndex
CREATE INDEX "BroadcastCampaign_status_scheduledAt_idx" ON "public"."BroadcastCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_status_createdAt_idx" ON "public"."BroadcastDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastDelivery_campaignId_userId_channel_key" ON "public"."BroadcastDelivery"("campaignId", "userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "public"."ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralVisit_codeId_createdAt_idx" ON "public"."ReferralVisit"("codeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralConversion_codeId_orderId_key" ON "public"."ReferralConversion"("codeId", "orderId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "public"."AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "public"."AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_availableAt_idx" ON "public"."OutboxEvent"("processedAt", "availableAt");

-- AddForeignKey
ALTER TABLE "public"."UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserProfile" ADD CONSTRAINT "UserProfile_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlatformRoleAssignment" ADD CONSTRAINT "PlatformRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Store" ADD CONSTRAINT "Store_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Store" ADD CONSTRAINT "Store_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Store" ADD CONSTRAINT "Store_bannerAssetId_fkey" FOREIGN KEY ("bannerAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreSetting" ADD CONSTRAINT "StoreSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreMembership" ADD CONSTRAINT "StoreMembership_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreMembership" ADD CONSTRAINT "StoreMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreMembershipPermission" ADD CONSTRAINT "StoreMembershipPermission_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."StoreMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierProfile" ADD CONSTRAINT "SupplierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierConnection" ADD CONSTRAINT "SupplierConnection_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierConnection" ADD CONSTRAINT "SupplierConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Brand" ADD CONSTRAINT "Brand_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "public"."ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "public"."ProductOptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryItem" ADD CONSTRAINT "InventoryItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "public"."InventoryItem"("variantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "public"."InventoryItem"("variantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductMedia" ADD CONSTRAINT "ProductMedia_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WishlistItem" ADD CONSTRAINT "WishlistItem_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "public"."Wishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutQuote" ADD CONSTRAINT "CheckoutQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutQuote" ADD CONSTRAINT "CheckoutQuote_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "public"."Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutQuote" ADD CONSTRAINT "CheckoutQuote_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "public"."Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutQuoteItem" ADD CONSTRAINT "CheckoutQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."CheckoutQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutQuoteItem" ADD CONSTRAINT "CheckoutQuoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."CheckoutQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreOrder" ADD CONSTRAINT "StoreOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StoreOrder" ADD CONSTRAINT "StoreOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_storeOrderId_fkey" FOREIGN KEY ("storeOrderId") REFERENCES "public"."StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "public"."ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Coupon" ADD CONSTRAINT "Coupon_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "public"."Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerAccount" ADD CONSTRAINT "LedgerAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_storeOrderId_fkey" FOREIGN KEY ("storeOrderId") REFERENCES "public"."StoreOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayoutDestination" ADD CONSTRAINT "PayoutDestination_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayoutRequest" ADD CONSTRAINT "PayoutRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayoutRequest" ADD CONSTRAINT "PayoutRequest_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "public"."PayoutDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayoutTransaction" ADD CONSTRAINT "PayoutTransaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "public"."PayoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "public"."SourcingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KycSubmission" ADD CONSTRAINT "KycSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KycSubmission" ADD CONSTRAINT "KycSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KycDocument" ADD CONSTRAINT "KycDocument_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."KycSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KycDocument" ADD CONSTRAINT "KycDocument_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dispute" ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dispute" ADD CONSTRAINT "Dispute_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "public"."Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeMessage" ADD CONSTRAINT "DisputeMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "public"."Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdCampaign" ADD CONSTRAINT "AdCampaign_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdCampaign" ADD CONSTRAINT "AdCampaign_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdEvent" ADD CONSTRAINT "AdEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingRequest" ADD CONSTRAINT "SourcingRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingRequest" ADD CONSTRAINT "SourcingRequest_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingItem" ADD CONSTRAINT "SourcingItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingItem" ADD CONSTRAINT "SourcingItem_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingQuote" ADD CONSTRAINT "SourcingQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingProcurement" ADD CONSTRAINT "SourcingProcurement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingProcurement" ADD CONSTRAINT "SourcingProcurement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourcingStatusHistory" ADD CONSTRAINT "SourcingStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RfqRequest" ADD CONSTRAINT "RfqRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RfqRequest" ADD CONSTRAINT "RfqRequest_awardedQuoteId_fkey" FOREIGN KEY ("awardedQuoteId") REFERENCES "public"."RfqQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RfqQuote" ADD CONSTRAINT "RfqQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."RfqRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RfqQuote" ADD CONSTRAINT "RfqQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceListing" ADD CONSTRAINT "ServiceListing_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceListing" ADD CONSTRAINT "ServiceListing_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceBooking" ADD CONSTRAINT "ServiceBooking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "public"."ServiceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceBooking" ADD CONSTRAINT "ServiceBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_storeOrderId_fkey" FOREIGN KEY ("storeOrderId") REFERENCES "public"."StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "public"."FulfilmentHub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BroadcastCampaign" ADD CONSTRAINT "BroadcastCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."BroadcastCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralCode" ADD CONSTRAINT "ReferralCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralVisit" ADD CONSTRAINT "ReferralVisit_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "public"."ReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralVisit" ADD CONSTRAINT "ReferralVisit_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralConversion" ADD CONSTRAINT "ReferralConversion_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "public"."ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReferralConversion" ADD CONSTRAINT "ReferralConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SiteSetting" ADD CONSTRAINT "SiteSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot currently express in its schema DSL.
ALTER TABLE "public"."ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonnegative" CHECK ("priceKobo" >= 0 AND ("compareAtKobo" IS NULL OR "compareAtKobo" >= 0));
ALTER TABLE "public"."InventoryItem" ADD CONSTRAINT "InventoryItem_valid_quantities" CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand" AND "reorderPoint" >= 0);
ALTER TABLE "public"."CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "public"."CheckoutQuoteItem" ADD CONSTRAINT "CheckoutQuoteItem_values_valid" CHECK (quantity > 0 AND "unitPriceKobo" >= 0 AND "shippingUnitKobo" >= 0);
ALTER TABLE "public"."CheckoutQuote" ADD CONSTRAINT "CheckoutQuote_money_valid" CHECK ("subtotalKobo" >= 0 AND "shippingKobo" >= 0 AND "discountKobo" >= 0 AND "platformFeeKobo" >= 0 AND "totalKobo" = "subtotalKobo" + "shippingKobo" + "platformFeeKobo" - "discountKobo");
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_money_valid" CHECK ("subtotalKobo" >= 0 AND "shippingKobo" >= 0 AND "discountKobo" >= 0 AND "platformFeeKobo" >= 0 AND "totalKobo" = "subtotalKobo" + "shippingKobo" + "platformFeeKobo" - "discountKobo");
ALTER TABLE "public"."StoreOrder" ADD CONSTRAINT "StoreOrder_money_valid" CHECK ("subtotalKobo" >= 0 AND "shippingKobo" >= 0 AND "discountKobo" >= 0 AND "platformFeeKobo" >= 0 AND "commissionKobo" >= 0 AND "sellerNetKobo" >= 0 AND "totalKobo" >= 0);
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_values_valid" CHECK (quantity > 0 AND "unitPriceKobo" >= 0 AND "shippingUnitKobo" >= 0 AND "totalKobo" >= 0 AND "sellerAmountKobo" >= 0 AND "platformCommissionKobo" >= 0);
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "public"."Coupon" ADD CONSTRAINT "Coupon_discount_valid" CHECK (("percentOffBps" IS NULL OR ("percentOffBps" > 0 AND "percentOffBps" <= 10000)) AND ("fixedOffKobo" IS NULL OR "fixedOffKobo" > 0) AND ("percentOffBps" IS NOT NULL OR "fixedOffKobo" IS NOT NULL));
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_nonzero" CHECK ("amountKobo" <> 0);
ALTER TABLE "public"."PayoutRequest" ADD CONSTRAINT "PayoutRequest_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_rating_range" CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "public"."SourcingItem" ADD CONSTRAINT "SourcingItem_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "public"."SourcingQuote" ADD CONSTRAINT "SourcingQuote_money_valid" CHECK ("subtotalKobo" >= 0 AND "serviceKobo" >= 0 AND "shippingKobo" >= 0 AND "totalKobo" = "subtotalKobo" + "serviceKobo" + "shippingKobo");
ALTER TABLE "public"."RfqRequest" ADD CONSTRAINT "RfqRequest_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "public"."RfqQuote" ADD CONSTRAINT "RfqQuote_values_valid" CHECK ("unitPriceKobo" >= 0 AND "shippingKobo" >= 0 AND "leadTimeDays" >= 0 AND "minimumOrderQty" > 0);
ALTER TABLE "public"."AdCampaign" ADD CONSTRAINT "AdCampaign_budget_nonnegative" CHECK ("budgetKobo" >= 0);

CREATE UNIQUE INDEX "Address_one_default_per_user" ON "public"."Address"("userId") WHERE "isDefault" = true;
CREATE UNIQUE INDEX "Wishlist_one_default_per_user" ON "public"."Wishlist"("userId") WHERE "isDefault" = true;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
