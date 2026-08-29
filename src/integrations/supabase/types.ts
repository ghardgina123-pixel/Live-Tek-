export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          country_id: string | null
          created_at: string
          district: string | null
          district_id: string | null
          id: string
          is_default: boolean
          label: string
          lat: number | null
          lng: number | null
          municipality_id: string
          phone: string | null
          province_id: string
          recipient_name: string | null
          reference: string | null
          street: string
          updated_at: string
          user_id: string
        }
        Insert: {
          country_id?: string | null
          created_at?: string
          district?: string | null
          district_id?: string | null
          id?: string
          is_default?: boolean
          label?: string
          lat?: number | null
          lng?: number | null
          municipality_id: string
          phone?: string | null
          province_id: string
          recipient_name?: string | null
          reference?: string | null
          street: string
          updated_at?: string
          user_id: string
        }
        Update: {
          country_id?: string | null
          created_at?: string
          district?: string | null
          district_id?: string | null
          id?: string
          is_default?: boolean
          label?: string
          lat?: number | null
          lng?: number | null
          municipality_id?: string
          phone?: string | null
          province_id?: string
          recipient_name?: string | null
          reference?: string | null
          street?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notifications: {
        Row: {
          created_at: string
          emailed_at: string | null
          id: string
          kind: string
          payload: Json
          read_at: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          subject?: string
        }
        Relationships: []
      }
      affiliate_accounts: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          amount_aoa: number
          base_aoa: number
          created_at: string
          id: string
          note: string | null
          order_id: string | null
          rate_pct: number
          referral_id: string | null
          source: string
          status: Database["public"]["Enums"]["affiliate_commission_status"]
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          amount_aoa?: number
          base_aoa?: number
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          rate_pct?: number
          referral_id?: string | null
          source: string
          status?: Database["public"]["Enums"]["affiliate_commission_status"]
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          amount_aoa?: number
          base_aoa?: number
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          rate_pct?: number
          referral_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["affiliate_commission_status"]
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "affiliate_referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["affiliate_referral_kind"]
          referred_user_id: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["affiliate_referral_kind"]
          referred_user_id: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["affiliate_referral_kind"]
          referred_user_id?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_referrals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_live_fees: {
        Row: {
          agency_id: string
          amount_aoa: number
          approved_at: string | null
          created_at: string
          id: string
          live_id: string | null
          payment_method: string | null
          proof_url: string | null
          property_id: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["agency_live_fee_status"]
          updated_at: string
          verified_at: string | null
          verified_source: string | null
        }
        Insert: {
          agency_id: string
          amount_aoa?: number
          approved_at?: string | null
          created_at?: string
          id?: string
          live_id?: string | null
          payment_method?: string | null
          proof_url?: string | null
          property_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["agency_live_fee_status"]
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Update: {
          agency_id?: string
          amount_aoa?: number
          approved_at?: string | null
          created_at?: string
          id?: string
          live_id?: string | null
          payment_method?: string | null
          proof_url?: string | null
          property_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["agency_live_fee_status"]
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_live_fees_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "real_estate_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_live_fees_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          last_message_at: string
          store_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          last_message_at?: string
          store_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          last_message_at?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          active: boolean
          center_lat: number | null
          center_lng: number | null
          code: string
          created_at: string
          currency_code: string | null
          currency_symbol: string | null
          default_zoom: number
          id: string
          language_code: string
          locale: string
          name: string
          phone_prefix: string | null
        }
        Insert: {
          active?: boolean
          center_lat?: number | null
          center_lng?: number | null
          code: string
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          default_zoom?: number
          id?: string
          language_code?: string
          locale?: string
          name: string
          phone_prefix?: string | null
        }
        Update: {
          active?: boolean
          center_lat?: number | null
          center_lng?: number | null
          code?: string
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          default_zoom?: number
          id?: string
          language_code?: string
          locale?: string
          name?: string
          phone_prefix?: string | null
        }
        Relationships: []
      }
      couriers: {
        Row: {
          company_name: string | null
          country_id: string | null
          courier_type: Database["public"]["Enums"]["courier_type"]
          created_at: string
          district: string | null
          district_id: string | null
          document_id: string
          document_photo_url: string | null
          driver_license: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          lat: number | null
          license_photo_url: string | null
          lng: number | null
          municipality_id: string | null
          notes: string | null
          phone: string
          province_id: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["courier_status"]
          street: string | null
          updated_at: string
          user_id: string
          vehicle_brand: string | null
          vehicle_color: string | null
          vehicle_model: string | null
          vehicle_photo_url: string | null
          vehicle_plate: string | null
        }
        Insert: {
          company_name?: string | null
          country_id?: string | null
          courier_type: Database["public"]["Enums"]["courier_type"]
          created_at?: string
          district?: string | null
          district_id?: string | null
          document_id: string
          document_photo_url?: string | null
          driver_license?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          id?: string
          lat?: number | null
          license_photo_url?: string | null
          lng?: number | null
          municipality_id?: string | null
          notes?: string | null
          phone: string
          province_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["courier_status"]
          street?: string | null
          updated_at?: string
          user_id: string
          vehicle_brand?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_photo_url?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          company_name?: string | null
          country_id?: string | null
          courier_type?: Database["public"]["Enums"]["courier_type"]
          created_at?: string
          district?: string | null
          district_id?: string | null
          document_id?: string
          document_photo_url?: string | null
          driver_license?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          lat?: number | null
          license_photo_url?: string | null
          lng?: number | null
          municipality_id?: string | null
          notes?: string | null
          phone?: string
          province_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["courier_status"]
          street?: string | null
          updated_at?: string
          user_id?: string
          vehicle_brand?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_photo_url?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couriers_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couriers_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          assigned_at: string | null
          courier_id: string | null
          created_at: string
          delivered_at: string | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          id: string
          order_id: string
          picked_up_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          courier_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          id?: string
          order_id: string
          picked_up_at?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          courier_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          id?: string
          order_id?: string
          picked_up_at?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tracking: {
        Row: {
          delivery_id: string
          id: number
          lat: number
          lng: number
          updated_at: string
        }
        Insert: {
          delivery_id: string
          id?: number
          lat: number
          lng: number
          updated_at?: string
        }
        Update: {
          delivery_id?: string
          id?: number
          lat?: number
          lng?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      districts: {
        Row: {
          created_at: string
          id: string
          municipality_id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          municipality_id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          municipality_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "districts_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          created_at: string
          from_currency: string
          id: string
          rate: number
          source: string
          to_currency: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_currency: string
          id?: string
          rate: number
          source?: string
          to_currency: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_currency?: string
          id?: string
          rate?: number
          source?: string
          to_currency?: string
          updated_at?: string
        }
        Relationships: []
      }
      global_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          ref_id: string | null
          title: string
          url: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          ref_id?: string | null
          title: string
          url?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          ref_id?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      live_cameras: {
        Row: {
          created_at: string
          id: string
          ingress_id: string | null
          ingress_url: string | null
          label: string
          last_error: string | null
          last_seen_at: string | null
          last_stats: Json
          live_id: string | null
          participant_identity: string
          source_type: string
          source_url: string | null
          status: string
          store_id: string
          stream_key: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingress_id?: string | null
          ingress_url?: string | null
          label: string
          last_error?: string | null
          last_seen_at?: string | null
          last_stats?: Json
          live_id?: string | null
          participant_identity: string
          source_type: string
          source_url?: string | null
          status?: string
          store_id: string
          stream_key?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingress_id?: string | null
          ingress_url?: string | null
          label?: string
          last_error?: string | null
          last_seen_at?: string | null
          last_stats?: Json
          live_id?: string | null
          participant_identity?: string
          source_type?: string
          source_url?: string | null
          status?: string
          store_id?: string
          stream_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_cameras_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_cameras_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      live_events: {
        Row: {
          actor_id: string | null
          camera_id: string | null
          created_at: string
          id: string
          kind: string
          level: string
          live_id: string | null
          message: string
          metadata: Json
          store_id: string
        }
        Insert: {
          actor_id?: string | null
          camera_id?: string | null
          created_at?: string
          id?: string
          kind: string
          level?: string
          live_id?: string | null
          message: string
          metadata?: Json
          store_id: string
        }
        Update: {
          actor_id?: string | null
          camera_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          level?: string
          live_id?: string | null
          message?: string
          metadata?: Json
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_events_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      live_likes: {
        Row: {
          created_at: string
          live_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          live_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          live_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_likes_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
        ]
      }
      live_messages: {
        Row: {
          created_at: string
          id: string
          live_id: string
          sender_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          live_id: string
          sender_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          live_id?: string
          sender_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_messages_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
        ]
      }
      live_products: {
        Row: {
          live_id: string
          product_id: string
        }
        Insert: {
          live_id: string
          product_id: string
        }
        Update: {
          live_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_products_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      live_viewers: {
        Row: {
          joined_at: string
          last_seen_at: string
          live_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          last_seen_at?: string
          live_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          last_seen_at?: string
          live_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_viewers_live_id_fkey"
            columns: ["live_id"]
            isOneToOne: false
            referencedRelation: "lives"
            referencedColumns: ["id"]
          },
        ]
      }
      lives: {
        Row: {
          active_camera_id: string | null
          active_identity: string | null
          created_at: string
          ended_at: string | null
          id: string
          livekit_room: string
          started_at: string | null
          status: Database["public"]["Enums"]["live_status"]
          store_id: string
          title: string
          viewer_count: number
        }
        Insert: {
          active_camera_id?: string | null
          active_identity?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          livekit_room: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["live_status"]
          store_id: string
          title: string
          viewer_count?: number
        }
        Update: {
          active_camera_id?: string | null
          active_identity?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          livekit_room?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["live_status"]
          store_id?: string
          title?: string
          viewer_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "lives_active_camera_id_fkey"
            columns: ["active_camera_id"]
            isOneToOne: false
            referencedRelation: "live_cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lives_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempts: number
          blocked_until: string | null
          first_attempt_at: string
          key: string
          last_attempt_at: string
        }
        Insert: {
          attempts?: number
          blocked_until?: string | null
          first_attempt_at?: string
          key: string
          last_attempt_at?: string
        }
        Update: {
          attempts?: number
          blocked_until?: string | null
          first_attempt_at?: string
          key?: string
          last_attempt_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
          text: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
          text: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      municipalities: {
        Row: {
          created_at: string
          id: string
          name: string
          province_id: string
          shipping_fee_aoa: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          province_id: string
          shipping_fee_aoa?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          province_id?: string
          shipping_fee_aoa?: number
        }
        Relationships: [
          {
            foreignKeyName: "municipalities_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          quantity: number
          unit_price_aoa: number
          unit_price_brl: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          quantity: number
          unit_price_aoa?: number
          unit_price_brl: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          unit_price_aoa?: number
          unit_price_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string | null
          created_at: string
          customer_id: string
          id: string
          paid_at: string | null
          payment_method: string | null
          shipping_aoa: number
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal_aoa: number
          total_aoa: number
          total_brl: number
        }
        Insert: {
          address_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          shipping_aoa?: number
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal_aoa?: number
          total_aoa?: number
          total_brl: number
        }
        Update: {
          address_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          shipping_aoa?: number
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          subtotal_aoa?: number
          total_aoa?: number
          total_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount_aoa: number
          commission_pct: number
          created_at: string
          external_id: string | null
          id: string
          order_id: string
          platform_fee_aoa: number
          provider: string
          raw_payload: Json | null
          reference: string | null
          status: string
          store_amount_aoa: number
          updated_at: string
          verified_at: string | null
          verified_source: string | null
        }
        Insert: {
          amount_aoa: number
          commission_pct?: number
          created_at?: string
          external_id?: string | null
          id?: string
          order_id: string
          platform_fee_aoa: number
          provider?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          store_amount_aoa: number
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Update: {
          amount_aoa?: number
          commission_pct?: number
          created_at?: string
          external_id?: string | null
          id?: string
          order_id?: string
          platform_fee_aoa?: number
          provider?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          store_amount_aoa?: number
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          config: Json
          country_code: string
          created_at: string
          currency_code: string
          currency_symbol: string
          description: string | null
          display_name: string
          gateway_configured: boolean
          icon: string | null
          id: string
          is_active: boolean
          is_cash_on_delivery: boolean
          method_type: string
          requires_proof_upload: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          config?: Json
          country_code: string
          created_at?: string
          currency_code: string
          currency_symbol: string
          description?: string | null
          display_name: string
          gateway_configured?: boolean
          icon?: string | null
          id?: string
          is_active?: boolean
          is_cash_on_delivery?: boolean
          method_type: string
          requires_proof_upload?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          country_code?: string
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          description?: string | null
          display_name?: string
          gateway_configured?: boolean
          icon?: string | null
          id?: string
          is_active?: boolean
          is_cash_on_delivery?: boolean
          method_type?: string
          requires_proof_upload?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payout_requests: {
        Row: {
          amount_aoa: number
          created_at: string
          destination: Json
          due_at: string
          id: string
          kind: string
          method: string
          note: string | null
          processed_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_aoa: number
          created_at?: string
          destination?: Json
          due_at?: string
          id?: string
          kind: string
          method?: string
          note?: string | null
          processed_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_aoa?: number
          created_at?: string
          destination?: Json
          due_at?: string
          id?: string
          kind?: string
          method?: string
          note?: string | null
          processed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payouts: {
        Row: {
          commission_pct: number
          created_at: string
          gross_aoa: number
          gross_brl: number
          id: string
          net_aoa: number
          net_brl: number
          order_id: string
          platform_fee_aoa: number
          release_at: string
          released_at: string | null
          status: Database["public"]["Enums"]["payout_status"]
          store_id: string
        }
        Insert: {
          commission_pct?: number
          created_at?: string
          gross_aoa?: number
          gross_brl: number
          id?: string
          net_aoa?: number
          net_brl: number
          order_id: string
          platform_fee_aoa?: number
          release_at: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          store_id: string
        }
        Update: {
          commission_pct?: number
          created_at?: string
          gross_aoa?: number
          gross_brl?: number
          id?: string
          net_aoa?: number
          net_brl?: number
          order_id?: string
          platform_fee_aoa?: number
          release_at?: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_videos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          product_id: string | null
          store_id: string
          thumbnail_url: string | null
          video_url: string
          views: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          store_id: string
          thumbnail_url?: string | null
          video_url: string
          views?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          store_id?: string
          thumbnail_url?: string | null
          video_url?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_videos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_videos_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          price_aoa: number
          price_brl: number
          rejection_reason: string | null
          status: Database["public"]["Enums"]["product_status"]
          stock: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price_aoa?: number
          price_brl: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price_aoa?: number
          price_brl?: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country_code: string
          country_id: string | null
          created_at: string
          display_name: string | null
          id: string
          is_online: boolean
          language_code: string | null
          last_seen_at: string | null
          partner_type: Database["public"]["Enums"]["partner_type"] | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          country_code?: string
          country_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_online?: boolean
          language_code?: string | null
          last_seen_at?: string | null
          partner_type?: Database["public"]["Enums"]["partner_type"] | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          country_code?: string
          country_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_online?: boolean
          language_code?: string | null
          last_seen_at?: string | null
          partner_type?: Database["public"]["Enums"]["partner_type"] | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          agency_id: string
          area_m2: number | null
          bathrooms: number | null
          bedrooms: number | null
          country_id: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          district: string | null
          district_id: string | null
          featured: boolean
          furnished: boolean
          id: string
          lat: number | null
          listing_type: Database["public"]["Enums"]["listing_type"]
          lng: number | null
          municipality_id: string | null
          parking_spots: number | null
          price_aoa: number
          property_type: Database["public"]["Enums"]["property_type"]
          province_id: string | null
          rejection_reason: string | null
          rent_period: string | null
          status: Database["public"]["Enums"]["property_status"]
          street: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          area_m2?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          district_id?: string | null
          featured?: boolean
          furnished?: boolean
          id?: string
          lat?: number | null
          listing_type: Database["public"]["Enums"]["listing_type"]
          lng?: number | null
          municipality_id?: string | null
          parking_spots?: number | null
          price_aoa?: number
          property_type: Database["public"]["Enums"]["property_type"]
          province_id?: string | null
          rejection_reason?: string | null
          rent_period?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          street?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          area_m2?: number | null
          bathrooms?: number | null
          bedrooms?: number | null
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          district_id?: string | null
          featured?: boolean
          furnished?: boolean
          id?: string
          lat?: number | null
          listing_type?: Database["public"]["Enums"]["listing_type"]
          lng?: number | null
          municipality_id?: string | null
          parking_spots?: number | null
          price_aoa?: number
          property_type?: Database["public"]["Enums"]["property_type"]
          province_id?: string | null
          rejection_reason?: string | null
          rent_period?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          street?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "real_estate_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      property_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          property_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          property_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          property_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_images_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_visit_requests: {
        Row: {
          contact_phone: string
          created_at: string
          customer_id: string
          id: string
          message: string | null
          preferred_date: string
          preferred_time: string | null
          property_id: string
          status: Database["public"]["Enums"]["visit_request_status"]
          updated_at: string
        }
        Insert: {
          contact_phone: string
          created_at?: string
          customer_id: string
          id?: string
          message?: string | null
          preferred_date: string
          preferred_time?: string | null
          property_id: string
          status?: Database["public"]["Enums"]["visit_request_status"]
          updated_at?: string
        }
        Update: {
          contact_phone?: string
          created_at?: string
          customer_id?: string
          id?: string
          message?: string | null
          preferred_date?: string
          preferred_time?: string | null
          property_id?: string
          status?: Database["public"]["Enums"]["visit_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_visit_requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      provinces: {
        Row: {
          country_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          country_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          country_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      real_estate_agencies: {
        Row: {
          country_id: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          district: string | null
          district_id: string | null
          email: string | null
          id: string
          lat: number | null
          lng: number | null
          logo_url: string | null
          municipality_id: string | null
          name: string
          nif: string
          owner_id: string
          phone: string
          province_id: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["agency_status"]
          street: string | null
          updated_at: string
        }
        Insert: {
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          district_id?: string | null
          email?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          municipality_id?: string | null
          name: string
          nif: string
          owner_id: string
          phone: string
          province_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          street?: string | null
          updated_at?: string
        }
        Update: {
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          district_id?: string | null
          email?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          municipality_id?: string | null
          name?: string
          nif?: string
          owner_id?: string
          phone?: string
          province_id?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          street?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "real_estate_agencies_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_estate_agencies_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_estate_agencies_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_estate_agencies_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_log: {
        Row: {
          actor_id: string | null
          event: string
          id: string
          ip: unknown
          metadata: Json
          occurred_at: string
          severity: string
          subject_id: string | null
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          event: string
          id?: string
          ip?: unknown
          metadata?: Json
          occurred_at?: string
          severity?: string
          subject_id?: string | null
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          event?: string
          id?: string
          ip?: unknown
          metadata?: Json
          occurred_at?: string
          severity?: string
          subject_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      security_config_snapshots: {
        Row: {
          id: string
          label: string
          payload: Json
          taken_at: string
        }
        Insert: {
          id?: string
          label: string
          payload: Json
          taken_at?: string
        }
        Update: {
          id?: string
          label?: string
          payload?: Json
          taken_at?: string
        }
        Relationships: []
      }
      service_requirements: {
        Row: {
          created_at: string
          description: string | null
          id: string
          input_type: string
          is_active: boolean
          is_required: boolean
          key: string
          label: string
          service_category: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          input_type?: string
          is_active?: boolean
          is_required?: boolean
          key: string
          label: string
          service_category?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          input_type?: string
          is_active?: boolean
          is_required?: boolean
          key?: string
          label?: string
          service_category?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_submissions: {
        Row: {
          created_at: string
          file_url: string | null
          id: string
          requirement_key: string
          store_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          file_url?: string | null
          id?: string
          requirement_key: string
          store_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          file_url?: string | null
          id?: string
          requirement_key?: string
          store_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_submissions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      short_comments: {
        Row: {
          created_at: string
          id: string
          text: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          text: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          text?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "product_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      short_likes: {
        Row: {
          created_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_likes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "product_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_campaign_config: {
        Row: {
          country_code: string
          created_at: string
          fee_aoa: number
          free_slots: number
          id: number
          is_active: boolean
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          fee_aoa?: number
          free_slots?: number
          id?: number
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          fee_aoa?: number
          free_slots?: number
          id?: number
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      store_private: {
        Row: {
          bank_account: string | null
          bank_holder: string | null
          bank_name: string | null
          created_at: string
          nif: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          created_at?: string
          nif?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          created_at?: string
          nif?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_private_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_signup_fees: {
        Row: {
          amount_aoa: number
          created_at: string
          id: string
          method: string | null
          proof_url: string | null
          reference: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_aoa?: number
          created_at?: string
          id?: string
          method?: string | null
          proof_url?: string | null
          reference?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_aoa?: number
          created_at?: string
          id?: string
          method?: string | null
          proof_url?: string | null
          reference?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_signup_fees_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_subscriptions: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          expires_at: string | null
          external_id: string | null
          grace_until: string | null
          id: string
          payment_method: string | null
          plan: string
          price_aoa: number
          proof_url: string | null
          provider: string | null
          raw_payload: Json | null
          reference: string | null
          rejection_reason: string | null
          started_at: string | null
          status: string
          store_id: string
          updated_at: string
          verified_at: string | null
          verified_source: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          grace_until?: string | null
          id?: string
          payment_method?: string | null
          plan?: string
          price_aoa?: number
          proof_url?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reference?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
          store_id: string
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          grace_until?: string | null
          id?: string
          payment_method?: string | null
          plan?: string
          price_aoa?: number
          proof_url?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reference?: string | null
          rejection_reason?: string | null
          started_at?: string | null
          status?: string
          store_id?: string
          updated_at?: string
          verified_at?: string | null
          verified_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_subscriptions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          category: string | null
          country_id: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          district_id: string | null
          id: string
          is_online: boolean
          is_suspended: boolean
          last_seen_at: string | null
          lat: number | null
          lng: number | null
          logo_url: string | null
          municipality_id: string | null
          name: string
          opening_hours: string | null
          owner_id: string
          partner_type: Database["public"]["Enums"]["partner_type"]
          phone: string | null
          province_id: string | null
          rating: number | null
          registration_position: number | null
          rejection_reason: string | null
          review_state: string
          service_category: string | null
          service_tags: string[]
          signup_fee_aoa: number
          signup_fee_required: boolean
          signup_fee_status: string
          signup_fee_waived_at: string | null
          signup_fee_waived_by: string | null
          signup_fee_waived_reason: string | null
          slug: string | null
          status: Database["public"]["Enums"]["store_status"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          category?: string | null
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district_id?: string | null
          id?: string
          is_online?: boolean
          is_suspended?: boolean
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          municipality_id?: string | null
          name: string
          opening_hours?: string | null
          owner_id: string
          partner_type?: Database["public"]["Enums"]["partner_type"]
          phone?: string | null
          province_id?: string | null
          rating?: number | null
          registration_position?: number | null
          rejection_reason?: string | null
          review_state?: string
          service_category?: string | null
          service_tags?: string[]
          signup_fee_aoa?: number
          signup_fee_required?: boolean
          signup_fee_status?: string
          signup_fee_waived_at?: string | null
          signup_fee_waived_by?: string | null
          signup_fee_waived_reason?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["store_status"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          category?: string | null
          country_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          district_id?: string | null
          id?: string
          is_online?: boolean
          is_suspended?: boolean
          last_seen_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          municipality_id?: string | null
          name?: string
          opening_hours?: string | null
          owner_id?: string
          partner_type?: Database["public"]["Enums"]["partner_type"]
          phone?: string | null
          province_id?: string | null
          rating?: number | null
          registration_position?: number | null
          rejection_reason?: string | null
          review_state?: string
          service_category?: string | null
          service_tags?: string[]
          signup_fee_aoa?: number
          signup_fee_required?: boolean
          signup_fee_status?: string
          signup_fee_waived_at?: string | null
          signup_fee_waived_by?: string | null
          signup_fee_waived_reason?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["store_status"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_history: {
        Row: {
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          store_id: string
          subscription_id: string
          to_status: string
        }
        Insert: {
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          store_id: string
          subscription_id: string
          to_status: string
        }
        Update: {
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          store_id?: string
          subscription_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_invoices: {
        Row: {
          amount_aoa: number
          created_at: string
          currency_code: string
          customer_snapshot: Json
          id: string
          issued_at: string
          number: string
          payment_method: string | null
          period_end: string | null
          period_start: string
          plan_code: string
          plan_name: string
          reference: string | null
          status: string
          store_id: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          amount_aoa: number
          created_at?: string
          currency_code?: string
          customer_snapshot?: Json
          id?: string
          issued_at?: string
          number: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string
          plan_code: string
          plan_name: string
          reference?: string | null
          status?: string
          store_id: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          amount_aoa?: number
          created_at?: string
          currency_code?: string
          customer_snapshot?: Json
          id?: string
          issued_at?: string
          number?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string
          plan_code?: string
          plan_name?: string
          reference?: string | null
          status?: string
          store_id?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_invoices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_logs: {
        Row: {
          actor_id: string | null
          created_at: string
          event: string
          id: string
          metadata: Json
          store_id: string | null
          subscription_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: string
          id?: string
          metadata?: Json
          store_id?: string | null
          subscription_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: string
          metadata?: Json
          store_id?: string | null
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_logs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_notifications: {
        Row: {
          created_at: string
          cycle_expires_at: string | null
          id: string
          milestone: string
          store_id: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          cycle_expires_at?: string | null
          id?: string
          milestone: string
          store_id: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          cycle_expires_at?: string | null
          id?: string
          milestone?: string
          store_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_notifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount_aoa: number
          created_at: string
          external_id: string | null
          id: string
          method: string | null
          paid_at: string
          raw_payload: Json | null
          reference: string | null
          status: string
          store_id: string
          subscription_id: string
        }
        Insert: {
          amount_aoa: number
          created_at?: string
          external_id?: string | null
          id?: string
          method?: string | null
          paid_at?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          store_id: string
          subscription_id: string
        }
        Update: {
          amount_aoa?: number
          created_at?: string
          external_id?: string | null
          id?: string
          method?: string | null
          paid_at?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          store_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "store_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          audience: string
          categories: string[]
          code: string
          created_at: string
          currency_code: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          max_lives_per_month: number | null
          name: string
          period_days: number
          price_aoa: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          audience?: string
          categories?: string[]
          code: string
          created_at?: string
          currency_code?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          max_lives_per_month?: number | null
          name: string
          period_days?: number
          price_aoa: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          audience?: string
          categories?: string[]
          code?: string
          created_at?: string
          currency_code?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          max_lives_per_month?: number | null
          name?: string
          period_days?: number
          price_aoa?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          ref_id: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          ref_id?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          ref_id?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_payment_accounts: {
        Row: {
          account_holder: string | null
          account_number: string | null
          bank_name: string | null
          card_brand: string | null
          card_exp: string | null
          card_last4: string | null
          created_at: string
          extra: Json
          iban: string | null
          id: string
          is_default: boolean
          label: string | null
          method_type: string
          payment_method_id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          bank_name?: string | null
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          extra?: Json
          iban?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          method_type: string
          payment_method_id: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          bank_name?: string | null
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          extra?: Json
          iban?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          method_type?: string
          payment_method_id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_payment_accounts_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string | null
          is_online: boolean | null
          last_seen_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          is_online?: boolean | null
          last_seen_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          is_online?: boolean | null
          last_seen_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_subscription_by_reference: {
        Args: {
          _external_id?: string
          _payload?: Json
          _reference: string
          _verified_source?: string
        }
        Returns: Json
      }
      admin_approve_agency: { Args: { _agency_id: string }; Returns: undefined }
      admin_approve_agency_live_fee: {
        Args: { _fee_id: string }
        Returns: undefined
      }
      admin_approve_property: {
        Args: { _property_id: string }
        Returns: undefined
      }
      admin_approve_store: { Args: { _store_id: string }; Returns: undefined }
      admin_confirm_signup_fee: {
        Args: { _fee_id: string }
        Returns: undefined
      }
      admin_create_store_for_email: {
        Args: {
          _activate?: boolean
          _category?: string
          _email: string
          _name: string
          _phone?: string
        }
        Returns: string
      }
      admin_financial_summary: { Args: never; Returns: Json }
      admin_financial_transactions: {
        Args: {
          _from?: string
          _limit?: number
          _method?: string
          _status?: string
          _store_id?: string
          _to?: string
        }
        Returns: {
          commission_aoa: number
          created_at: string
          customer_name: string
          gross_aoa: number
          id: string
          items: number
          net_aoa: number
          paid_at: string
          payment_method: string
          reference: string
          status: string
          store_id: string
          store_name: string
          verified: boolean
          verified_source: string
        }[]
      }
      admin_list_subscriptions: {
        Args: { _status?: string }
        Returns: {
          cancelled_at: string
          created_at: string
          expires_at: string
          external_id: string
          id: string
          invoice_count: number
          owner_email: string
          payment_method: string
          plan: string
          plan_name: string
          price_aoa: number
          reference: string
          started_at: string
          status: string
          store_id: string
          store_name: string
        }[]
      }
      admin_payout_requests: {
        Args: never
        Returns: {
          amount_aoa: number
          created_at: string
          due_at: string
          id: string
          kind: string
          method: string
          processed_at: string
          status: string
          user_id: string
          user_name: string
        }[]
      }
      admin_reject_agency: {
        Args: { _agency_id: string; _reason: string }
        Returns: undefined
      }
      admin_reject_agency_live_fee: {
        Args: { _fee_id: string; _reason: string }
        Returns: undefined
      }
      admin_reject_property: {
        Args: { _property_id: string; _reason: string }
        Returns: undefined
      }
      admin_reject_signup_fee: {
        Args: { _fee_id: string; _reason: string }
        Returns: undefined
      }
      admin_reject_store: {
        Args: { _reason: string; _store_id: string }
        Returns: undefined
      }
      admin_reprocess_subscription: {
        Args: { _approve?: boolean; _reference: string }
        Returns: Json
      }
      admin_set_store_review_state: {
        Args: { _reason?: string; _state: string; _store_id: string }
        Returns: undefined
      }
      admin_settle_payout: {
        Args: { _note?: string; _payout_id: string; _status?: string }
        Returns: Json
      }
      admin_signup_fees: {
        Args: never
        Returns: {
          amount_aoa: number
          created_at: string
          first_50: boolean
          id: string
          method: string
          reference: string
          registration_index: number
          reviewed_at: string
          status: string
          store_id: string
          store_name: string
        }[]
      }
      admin_user_phone: { Args: { _user_id: string }; Returns: string }
      admin_waive_signup_fee: {
        Args: { _reason: string; _store_id: string }
        Returns: undefined
      }
      affiliate_dashboard: { Args: never; Returns: Json }
      affiliate_get_or_create_code: { Args: never; Returns: Json }
      affiliate_register_referral: { Args: { _code: string }; Returns: Json }
      affiliate_withdrawable: { Args: never; Returns: Json }
      approved_stores_count: { Args: never; Returns: number }
      calc_transaction_split: {
        Args: { _amount_aoa: number; _store_id: string }
        Returns: Json
      }
      can_access_realtime_topic: { Args: { _topic: string }; Returns: boolean }
      can_store_go_live: { Args: { _store_id: string }; Returns: boolean }
      cancel_store_subscription: {
        Args: { _reason?: string; _store_id: string }
        Returns: Json
      }
      check_login_throttle: { Args: { _keys: string[] }; Returns: Json }
      clear_login_attempts: { Args: { _keys: string[] }; Returns: undefined }
      confirm_payment_intent_by_reference: {
        Args: {
          _external_id?: string
          _payload?: Json
          _reference: string
          _verified_source: string
        }
        Returns: Json
      }
      courier_withdrawable: { Args: never; Returns: Json }
      create_order_with_items: {
        Args: {
          p_address_id: string
          p_items: Json
          p_payment_method?: string
          p_store_id: string
        }
        Returns: string
      }
      create_subscription_intent: {
        Args: {
          _payment_method?: string
          _plan_code: string
          _store_id: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dispatch_push: {
        Args: { _kind: string; _payload: Json }
        Returns: undefined
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_due_subscriptions: { Args: never; Returns: number }
      get_own_phone: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_delivery_courier: {
        Args: { _delivery_id: string; _user: string }
        Returns: boolean
      }
      is_delivery_participant: {
        Args: { _delivery_id: string; _user: string }
        Returns: boolean
      }
      is_trusted_payment_source: { Args: { _source: string }; Returns: boolean }
      log_security_event: {
        Args: {
          _actor?: string
          _event: string
          _metadata?: Json
          _severity?: string
          _subject?: string
        }
        Returns: string
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      rate_limit_hit: {
        Args: {
          _block_minutes: number
          _key: string
          _max_attempts: number
          _window_minutes: number
        }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      register_login_failure: {
        Args: {
          _block_minutes?: number
          _keys: string[]
          _max_attempts?: number
          _window_minutes?: number
        }
        Returns: Json
      }
      reject_subscription_by_reference: {
        Args: { _payload?: Json; _reference: string; _status: string }
        Returns: Json
      }
      request_payout: {
        Args: { _destination?: Json; _kind: string; _method?: string }
        Returns: Json
      }
      seller_create_delivery: { Args: { _order_id: string }; Returns: string }
      seller_signup_status: { Args: never; Returns: Json }
      set_store_partner_type: {
        Args: {
          _store_id: string
          _type: Database["public"]["Enums"]["partner_type"]
        }
        Returns: undefined
      }
      store_balance: { Args: { _store_id: string }; Returns: Json }
      store_commission_pct: { Args: { _store_id: string }; Returns: number }
      store_live_usage: { Args: { _store_id: string }; Returns: Json }
      store_subscription_status: { Args: { _store_id: string }; Returns: Json }
      subscription_renewal_notices: { Args: never; Returns: number }
    }
    Enums: {
      affiliate_commission_status: "pending" | "released" | "paid" | "cancelled"
      affiliate_referral_kind: "user" | "store"
      agency_live_fee_status: "pending" | "paid" | "approved" | "rejected"
      agency_status: "pending" | "active" | "rejected" | "suspended"
      app_role: "customer" | "seller" | "admin"
      courier_status: "pending" | "active" | "rejected" | "suspended"
      courier_type: "motoboy" | "carro" | "van" | "empresa"
      listing_type: "venda" | "arrendamento"
      live_status: "scheduled" | "live" | "ended"
      order_status:
        | "pending"
        | "paid"
        | "preparing"
        | "shipped"
        | "delivered"
        | "cancelled"
      partner_type: "retail" | "service"
      payout_status: "pending" | "released" | "failed"
      product_status: "pending" | "approved" | "rejected"
      property_status: "pending" | "approved" | "rejected" | "sold" | "rented"
      property_type:
        | "casa"
        | "apartamento"
        | "terreno"
        | "comercial"
        | "escritorio"
      store_status: "pending" | "active" | "rejected"
      visit_request_status: "pending" | "confirmed" | "rejected" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      affiliate_commission_status: ["pending", "released", "paid", "cancelled"],
      affiliate_referral_kind: ["user", "store"],
      agency_live_fee_status: ["pending", "paid", "approved", "rejected"],
      agency_status: ["pending", "active", "rejected", "suspended"],
      app_role: ["customer", "seller", "admin"],
      courier_status: ["pending", "active", "rejected", "suspended"],
      courier_type: ["motoboy", "carro", "van", "empresa"],
      listing_type: ["venda", "arrendamento"],
      live_status: ["scheduled", "live", "ended"],
      order_status: [
        "pending",
        "paid",
        "preparing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      partner_type: ["retail", "service"],
      payout_status: ["pending", "released", "failed"],
      product_status: ["pending", "approved", "rejected"],
      property_status: ["pending", "approved", "rejected", "sold", "rented"],
      property_type: [
        "casa",
        "apartamento",
        "terreno",
        "comercial",
        "escritorio",
      ],
      store_status: ["pending", "active", "rejected"],
      visit_request_status: ["pending", "confirmed", "rejected", "done"],
    },
  },
} as const
