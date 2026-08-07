CREATE TABLE "np_c_shop-product-reviews__photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"file" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-product-reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"member_author_id" uuid,
	"product" uuid NOT NULL,
	"purchase_key" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"verified_purchase" boolean DEFAULT true NOT NULL,
	"moderation_hidden" boolean DEFAULT false NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews__photos" ADD CONSTRAINT "np_c_shop-product-reviews__photos_parent_id_np_c_shop-product-reviews_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_c_shop-product-reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews__photos" ADD CONSTRAINT "np_c_shop-product-reviews__photos_file_np_media_id_fk" FOREIGN KEY ("file") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews" ADD CONSTRAINT "np_c_shop-product-reviews_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews" ADD CONSTRAINT "np_c_shop-product-reviews_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews" ADD CONSTRAINT "np_c_shop-product-reviews_member_author_id_np_members_id_fk" FOREIGN KEY ("member_author_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-product-reviews" ADD CONSTRAINT "np_c_shop-product-reviews_product_np_c_shop-products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."np_c_shop-products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_shop-product-reviews__photos_parent_idx" ON "np_c_shop-product-reviews__photos" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-product-reviews_status_idx" ON "np_c_shop-product-reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_shop-product-reviews_member_author_idx" ON "np_c_shop-product-reviews" USING btree ("member_author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-product-reviews_site_purchase_key_uidx" ON "np_c_shop-product-reviews" USING btree ("site_id","purchase_key");--> statement-breakpoint
CREATE INDEX "np_c_shop-product-reviews_site_idx" ON "np_c_shop-product-reviews" USING btree ("site_id");