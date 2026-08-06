CREATE TABLE "np_c_shop-shipping-policies__administrativeAreas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"area" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-shipping-policies__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_shipping_policies_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-shipping-policies__postalPrefixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"prefix" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-shipping-policies__products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_shipping_policies_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-shipping-policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"method_code" text NOT NULL,
	"kind" text DEFAULT 'base' NOT NULL,
	"label" text NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"free_threshold_minor" integer,
	"threshold_basis" text DEFAULT 'discounted-subtotal' NOT NULL,
	"minimum_days" integer,
	"maximum_days" integer,
	"destination_scope" text DEFAULT 'all' NOT NULL,
	"country_code" text,
	"cart_scope" text DEFAULT 'all' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__administrativeAreas" ADD CONSTRAINT "np_c_shop-shipping-policies__administrativeAreas_parent_id_np_c_shop-shipping-policies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_shop-shipping-policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__categories" ADD CONSTRAINT "np_c_shop-shipping-policies__categories_shop_shipping_policies_id_np_c_shop-shipping-policies_id_fk" FOREIGN KEY ("shop_shipping_policies_id") REFERENCES "public"."np_c_shop-shipping-policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__categories" ADD CONSTRAINT "np_c_shop-shipping-policies__categories_target_id_np_c_shop-categories_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_shop-categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__postalPrefixes" ADD CONSTRAINT "np_c_shop-shipping-policies__postalPrefixes_parent_id_np_c_shop-shipping-policies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_shop-shipping-policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__products" ADD CONSTRAINT "np_c_shop-shipping-policies__products_shop_shipping_policies_id_np_c_shop-shipping-policies_id_fk" FOREIGN KEY ("shop_shipping_policies_id") REFERENCES "public"."np_c_shop-shipping-policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies__products" ADD CONSTRAINT "np_c_shop-shipping-policies__products_target_id_np_c_shop-products_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_shop-products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies" ADD CONSTRAINT "np_c_shop-shipping-policies_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-shipping-policies" ADD CONSTRAINT "np_c_shop-shipping-policies_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies__administrativeAreas_parent_idx" ON "np_c_shop-shipping-policies__administrativeAreas" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies__categories_shop_shipping_policies_id_idx" ON "np_c_shop-shipping-policies__categories" USING btree ("shop_shipping_policies_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-shipping-policies__categories_parent_target_uidx" ON "np_c_shop-shipping-policies__categories" USING btree ("shop_shipping_policies_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies__postalPrefixes_parent_idx" ON "np_c_shop-shipping-policies__postalPrefixes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies__products_shop_shipping_policies_id_idx" ON "np_c_shop-shipping-policies__products" USING btree ("shop_shipping_policies_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-shipping-policies__products_parent_target_uidx" ON "np_c_shop-shipping-policies__products" USING btree ("shop_shipping_policies_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies_status_idx" ON "np_c_shop-shipping-policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_shop-shipping-policies_site_idx" ON "np_c_shop-shipping-policies" USING btree ("site_id");