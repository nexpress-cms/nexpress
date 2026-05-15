ALTER TABLE "np_c_posts" ADD COLUMN "seo_meta_title" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "seo_meta_description" text;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD COLUMN "seo_og_image" uuid;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_seo_og_image_np_media_id_fk" FOREIGN KEY ("seo_og_image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;