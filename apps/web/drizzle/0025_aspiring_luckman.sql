CREATE TABLE "np_c_shop-categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image" uuid,
	"featured" boolean DEFAULT false,
	"display_order" integer DEFAULT 0 NOT NULL,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-products__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_products_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-products__gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"image" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"description" jsonb NOT NULL,
	"primary_image" uuid,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"compare_at_price_minor" integer,
	"tax_included" boolean DEFAULT true,
	"sku" text,
	"track_inventory" boolean DEFAULT true,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"featured" boolean DEFAULT false,
	"available" boolean DEFAULT false NOT NULL,
	"inventory_state" text DEFAULT 'out-of-stock' NOT NULL,
	"skin" text DEFAULT 'classic' NOT NULL,
	"slug" text NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-products__variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"option_summary" text,
	"price_minor" integer,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "np_c_shop-categories" ADD CONSTRAINT "np_c_shop-categories_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-categories" ADD CONSTRAINT "np_c_shop-categories_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-categories" ADD CONSTRAINT "np_c_shop-categories_image_np_media_id_fk" FOREIGN KEY ("image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products__categories" ADD CONSTRAINT "np_c_shop-products__categories_shop_products_id_np_c_shop-products_id_fk" FOREIGN KEY ("shop_products_id") REFERENCES "public"."np_c_shop-products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products__categories" ADD CONSTRAINT "np_c_shop-products__categories_target_id_np_c_shop-categories_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_shop-categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products__gallery" ADD CONSTRAINT "np_c_shop-products__gallery_parent_id_np_c_shop-products_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_shop-products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products__gallery" ADD CONSTRAINT "np_c_shop-products__gallery_image_np_media_id_fk" FOREIGN KEY ("image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products" ADD CONSTRAINT "np_c_shop-products_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products" ADD CONSTRAINT "np_c_shop-products_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products" ADD CONSTRAINT "np_c_shop-products_primary_image_np_media_id_fk" FOREIGN KEY ("primary_image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-products__variants" ADD CONSTRAINT "np_c_shop-products__variants_parent_id_np_c_shop-products_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_shop-products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_shop-categories_status_idx" ON "np_c_shop-categories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-categories_site_slug_idx" ON "np_c_shop-categories" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_shop-categories_site_idx" ON "np_c_shop-categories" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-products__categories_shop_products_id_idx" ON "np_c_shop-products__categories" USING btree ("shop_products_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-products__categories_parent_target_uidx" ON "np_c_shop-products__categories" USING btree ("shop_products_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-products__gallery_parent_idx" ON "np_c_shop-products__gallery" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-products_status_idx" ON "np_c_shop-products" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-products_site_sku_uidx" ON "np_c_shop-products" USING btree ("site_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-products_site_slug_idx" ON "np_c_shop-products" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_shop-products_site_idx" ON "np_c_shop-products" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-products__variants_parent_idx" ON "np_c_shop-products__variants" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-products__variants_parent_sku_uidx" ON "np_c_shop-products__variants" USING btree ("parent_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_forum-boards_site_key_uidx" ON "np_c_forum-boards" USING btree ("site_id","key");