/** Chaves de tradução usadas em toda a aplicação. */
export const KEYS = [
  "nav_home","nav_stores","nav_shorts","nav_cart","nav_profile",
  "search","search_placeholder","no_results","loading","select","all","retry","save","cancel","confirm",
  "back","close","edit","delete","add","remove","share","copy","copied","continue","done","yes","no",
  "optional","required_field",
  "login","logout","signup","email","password","phone","full_name","forgot_password","show_password",
  "hide_password","create_account","have_account","no_account","welcome_back","continue_google",
  "v_email_invalid","v_password_min","v_name_short","v_phone_invalid","error_generic","error_network",
  "error_unauthorized","saved_success",
  "cart_title","cart_empty","subtotal","delivery_fee","total","checkout","place_order","payment_method",
  "address","add_address","order_placed","quantity","add_to_cart","buy_now","out_of_stock",
  "my_orders","track_order","invoice","status_pending","status_paid","status_shipped","status_delivered",
  "status_cancelled",
  "profile_title","favorites","addresses","help_support","settings","security","language","currency",
  "country","region_settings","region_hint","edit_profile","guest","seller_panel",
  "live_now","viewers","likes","start_live","end_live","chat_placeholder","send","live_ended",
  "stores","products","price","stock","description","store",
  "province","municipality","district","select_country_first","select_province_first","select_municipality_first",
  "notifications_title","mark_all_read","no_notifications",
] as const;

export type TKey = (typeof KEYS)[number];
export type Dict = Record<TKey, string>;
