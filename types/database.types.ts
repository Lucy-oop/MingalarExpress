// Generated from migrations 0001-0022 via postgres-meta (the same generator
// the Supabase CLI uses). DO NOT EDIT BY HAND.
// Regenerate:  npm run db:types      (supabase gen types typescript --local)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          base_delivery_fee: number
          bbox_east: number
          bbox_north: number
          bbox_south: number
          bbox_west: number
          brand_name: string
          default_coverage_km: number
          free_km: number
          geocoder_base_url: string
          geocoder_provider: string
          id: boolean
          kpay_account_name: string | null
          kpay_phone: string | null
          kpay_qr_url: string
          map_center_lat: number
          map_center_lng: number
          map_default_zoom: number
          map_provider: string
          max_collection_attempts: number
          max_delivery_attempts: number
          min_parcels_per_trip: number
          offer_ttl_seconds: number
          order_code_prefix: string
          per_km_fee: number
          rider_commission_pct: number
          rider_ping_stale_min: number
          road_factor: number
          route_parcel_rate: number
          route_pickup_rate: number
          support_phone: string | null
          tile_attribution: string
          tile_url_template: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_delivery_fee?: number
          bbox_east?: number
          bbox_north?: number
          bbox_south?: number
          bbox_west?: number
          brand_name?: string
          default_coverage_km?: number
          free_km?: number
          geocoder_base_url?: string
          geocoder_provider?: string
          id?: boolean
          kpay_account_name?: string | null
          kpay_phone?: string | null
          kpay_qr_url?: string
          map_center_lat?: number
          map_center_lng?: number
          map_default_zoom?: number
          map_provider?: string
          max_collection_attempts?: number
          max_delivery_attempts?: number
          min_parcels_per_trip?: number
          offer_ttl_seconds?: number
          order_code_prefix?: string
          per_km_fee?: number
          rider_commission_pct?: number
          rider_ping_stale_min?: number
          road_factor?: number
          route_parcel_rate?: number
          route_pickup_rate?: number
          support_phone?: string | null
          tile_attribution?: string
          tile_url_template?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_delivery_fee?: number
          bbox_east?: number
          bbox_north?: number
          bbox_south?: number
          bbox_west?: number
          brand_name?: string
          default_coverage_km?: number
          free_km?: number
          geocoder_base_url?: string
          geocoder_provider?: string
          id?: boolean
          kpay_account_name?: string | null
          kpay_phone?: string | null
          kpay_qr_url?: string
          map_center_lat?: number
          map_center_lng?: number
          map_default_zoom?: number
          map_provider?: string
          max_collection_attempts?: number
          max_delivery_attempts?: number
          min_parcels_per_trip?: number
          offer_ttl_seconds?: number
          order_code_prefix?: string
          per_km_fee?: number
          rider_commission_pct?: number
          rider_ping_stale_min?: number
          road_factor?: number
          route_parcel_rate?: number
          route_pickup_rate?: number
          support_phone?: string | null
          tile_attribution?: string
          tile_url_template?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_table: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cod_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          kind: Database["public"]["Enums"]["ledger_kind"]
          memo: string | null
          order_id: string | null
          rider_id: string
          settlement_id: string | null
          trip_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          kind: Database["public"]["Enums"]["ledger_kind"]
          memo?: string | null
          order_id?: string | null
          rider_id: string
          settlement_id?: string | null
          trip_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          kind?: Database["public"]["Enums"]["ledger_kind"]
          memo?: string | null
          order_id?: string | null
          rider_id?: string
          settlement_id?: string | null
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cod_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cod_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cod_ledger_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cod_ledger_settlement_fk"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cod_ledger_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      order_assignments: {
        Row: {
          distance_km: number | null
          expires_at: string
          id: string
          offered_at: string
          offered_by: string | null
          order_id: string
          rank: number | null
          responded_at: string | null
          response: Database["public"]["Enums"]["offer_response"]
          rider_id: string
        }
        Insert: {
          distance_km?: number | null
          expires_at?: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          order_id: string
          rank?: number | null
          responded_at?: string | null
          response?: Database["public"]["Enums"]["offer_response"]
          rider_id: string
        }
        Update: {
          distance_km?: number | null
          expires_at?: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          order_id?: string
          rank?: number | null
          responded_at?: string | null
          response?: Database["public"]["Enums"]["offer_response"]
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_assignments_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_acceptances: {
        Row: {
          accepted_at: string
          id: string
          policy_key: string
          profile_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          policy_key: string
          profile_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          policy_key?: string
          profile_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_acceptances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notes: {
        Row: {
          author_id: string | null
          author_role: Database["public"]["Enums"]["user_role"] | null
          body: string
          channel: string | null
          created_at: string
          id: number
          kind: string
          order_id: string
          party: string | null
        }
        Insert: {
          author_id?: string | null
          author_role?: Database["public"]["Enums"]["user_role"] | null
          body: string
          channel?: string | null
          created_at?: string
          id?: number
          kind?: string
          order_id: string
          party?: string | null
        }
        Update: {
          author_id?: string | null
          author_role?: Database["public"]["Enums"]["user_role"] | null
          body?: string
          channel?: string | null
          created_at?: string
          id?: number
          kind?: string
          order_id?: string
          party?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: number
          lat: number | null
          lng: number | null
          note: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: number
          lat?: number | null
          lng?: number | null
          note?: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: number
          lat?: number | null
          lng?: number | null
          note?: string | null
          order_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        Insert: {
          assign_distance_km?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          cod_amount?: number
          cod_status?: Database["public"]["Enums"]["cod_status"]
          code?: string
          collected_via?: string | null
          created_at?: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt?: string | null
          delivered_at?: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id?: string | null
          dropoff_geog?: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note?: string | null
          fail_reason?: string | null
          fee_payer?: string
          id?: string
          is_fragile?: boolean
          kpay_confirmed_at?: string | null
          kpay_confirmed_by?: string | null
          kpay_proof_path?: string | null
          kpay_reject_reason?: string | null
          kpay_rejected_at?: string | null
          parcel_desc: string
          parcel_value?: number | null
          parcel_weight_g?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          picked_up_at?: string | null
          pickup_address: string
          pickup_contact?: string | null
          pickup_geog?: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note?: string | null
          platform_fee_amount?: number | null
          proof_photo_path?: string | null
          proof_receiver?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rider_commission_amount?: number | null
          rider_commission_pct?: number | null
          rider_id?: string | null
          route_distance_km?: number | null
          route_id?: string | null
          shop_id: string
          status?: Database["public"]["Enums"]["order_status"]
          trip_id?: string | null
          trip_leg?: string | null
          updated_at?: string
        }
        Update: {
          assign_distance_km?: number | null
          assigned_at?: string | null
          assigned_by?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          cod_amount?: number
          cod_status?: Database["public"]["Enums"]["cod_status"]
          code?: string
          collected_via?: string | null
          created_at?: string
          created_by?: string
          customer_name?: string
          customer_phone?: string
          customer_phone_alt?: string | null
          delivered_at?: string | null
          delivery_fee?: number
          dropoff_address?: string
          dropoff_area_id?: string | null
          dropoff_geog?: unknown
          dropoff_lat?: number
          dropoff_lng?: number
          dropoff_note?: string | null
          fail_reason?: string | null
          fee_payer?: string
          id?: string
          is_fragile?: boolean
          kpay_confirmed_at?: string | null
          kpay_confirmed_by?: string | null
          kpay_proof_path?: string | null
          kpay_reject_reason?: string | null
          kpay_rejected_at?: string | null
          parcel_desc?: string
          parcel_value?: number | null
          parcel_weight_g?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          picked_up_at?: string | null
          pickup_address?: string
          pickup_contact?: string | null
          pickup_geog?: unknown
          pickup_lat?: number
          pickup_lng?: number
          pickup_note?: string | null
          platform_fee_amount?: number | null
          proof_photo_path?: string | null
          proof_receiver?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rider_commission_amount?: number | null
          rider_commission_pct?: number | null
          rider_id?: string | null
          route_distance_km?: number | null
          route_id?: string | null
          shop_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          trip_id?: string | null
          trip_leg?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_dropoff_area_id_fkey"
            columns: ["dropoff_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_kpay_confirmed_by_fkey"
            columns: ["kpay_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          preferred_lang: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          preferred_lang?: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          preferred_lang?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      rider_profiles: {
        Row: {
          active_order_count: number
          availability: Database["public"]["Enums"]["rider_availability"]
          base_area_id: string | null
          cod_float_limit: number
          commission_pct_override: number | null
          coverage_km: number
          created_at: string
          current_geog: unknown
          current_lat: number | null
          current_lng: number | null
          emergency_contact: string | null
          id: string
          is_online: boolean
          last_ping_at: string | null
          max_active_orders: number
          nrc_no: string | null
          updated_at: string
          vehicle_plate: string | null
        }
        Insert: {
          active_order_count?: number
          availability?: Database["public"]["Enums"]["rider_availability"]
          base_area_id?: string | null
          cod_float_limit?: number
          commission_pct_override?: number | null
          coverage_km?: number
          created_at?: string
          current_geog?: unknown
          current_lat?: number | null
          current_lng?: number | null
          emergency_contact?: string | null
          id: string
          is_online?: boolean
          last_ping_at?: string | null
          max_active_orders?: number
          nrc_no?: string | null
          updated_at?: string
          vehicle_plate?: string | null
        }
        Update: {
          active_order_count?: number
          availability?: Database["public"]["Enums"]["rider_availability"]
          base_area_id?: string | null
          cod_float_limit?: number
          commission_pct_override?: number | null
          coverage_km?: number
          created_at?: string
          current_geog?: unknown
          current_lat?: number | null
          current_lng?: number | null
          emergency_contact?: string | null
          id?: string
          is_online?: boolean
          last_ping_at?: string | null
          max_active_orders?: number
          nrc_no?: string | null
          updated_at?: string
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_profiles_base_area_id_fkey"
            columns: ["base_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_areas: {
        Row: {
          area_id: string
          created_at: string
          is_primary: boolean
          route_id: string
          stop_order: number
        }
        Insert: {
          area_id: string
          created_at?: string
          is_primary?: boolean
          route_id: string
          stop_order?: number
        }
        Update: {
          area_id?: string
          created_at?: string
          is_primary?: boolean
          route_id?: string
          stop_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_areas_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      route_pay_tiers: {
        Row: {
          base_pay: number
          created_at: string
          id: string
          max_parcels: number | null
          min_parcels: number
          route_id: string | null
        }
        Insert: {
          base_pay: number
          created_at?: string
          id?: string
          max_parcels?: number | null
          min_parcels: number
          route_id?: string | null
        }
        Update: {
          base_pay?: number
          created_at?: string
          id?: string
          max_parcels?: number | null
          min_parcels?: number
          route_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "route_pay_tiers_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          code: string
          colour: string
          created_at: string
          hub_geog: unknown
          hub_lat: number
          hub_lng: number
          id: string
          is_active: boolean
          max_cod_per_trip: number
          max_parcels_per_trip: number
          name: string
          name_mm: string | null
          pay_model: string
          per_parcel_fee: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          colour?: string
          created_at?: string
          hub_geog?: unknown
          hub_lat: number
          hub_lng: number
          id?: string
          is_active?: boolean
          max_cod_per_trip?: number
          max_parcels_per_trip?: number
          name: string
          name_mm?: string | null
          pay_model?: string
          per_parcel_fee: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          colour?: string
          created_at?: string
          hub_geog?: unknown
          hub_lat?: number
          hub_lng?: number
          id?: string
          is_active?: boolean
          max_cod_per_trip?: number
          max_parcels_per_trip?: number
          name?: string
          name_mm?: string | null
          pay_model?: string
          per_parcel_fee?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_areas: {
        Row: {
          boundary: unknown
          centroid: unknown
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          name_mm: string | null
          sort_order: number
        }
        Insert: {
          boundary?: unknown
          centroid?: unknown
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          name_mm?: string | null
          sort_order?: number
        }
        Update: {
          boundary?: unknown
          centroid?: unknown
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          name_mm?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          delivery_fees?: number
          gross_cod?: number
          id?: string
          net_due_platform?: number
          notes?: string | null
          order_count?: number
          paid_at?: string | null
          period_date: string
          platform_share?: number
          rider_earnings?: number
          rider_id: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          delivery_fees?: number
          gross_cod?: number
          id?: string
          net_due_platform?: number
          notes?: string | null
          order_count?: number
          paid_at?: string | null
          period_date?: string
          platform_share?: number
          rider_earnings?: number
          rider_id?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          area_id: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_id: string
          phone: string
          pickup_address: string
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          updated_at: string
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_id: string
          phone: string
          pickup_address: string
          pickup_geog?: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note?: string | null
          updated_at?: string
        }
        Update: {
          area_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          phone?: string
          pickup_address?: string
          pickup_geog?: unknown
          pickup_lat?: number
          pickup_lng?: number
          pickup_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shops_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        Insert: {
          base_pay?: number
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          depart_override_reason?: string | null
          depart_parcel_count?: number | null
          departed_at?: string | null
          departed_by?: string | null
          id?: string
          notes?: string | null
          parcel_count?: number
          parcel_pay?: number
          pay_tier_snapshot?: Json | null
          pickup_count?: number
          pickup_pay?: number
          returned_at?: string | null
          rider_id?: string | null
          route_id: string
          service_date: string
          status?: Database["public"]["Enums"]["trip_status"]
          total_pay?: number
          updated_at?: string
        }
        Update: {
          base_pay?: number
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          depart_override_reason?: string | null
          depart_parcel_count?: number | null
          departed_at?: string | null
          departed_by?: string | null
          id?: string
          notes?: string | null
          parcel_count?: number
          parcel_pay?: number
          pay_tier_snapshot?: Json | null
          pickup_count?: number
          pickup_pay?: number
          returned_at?: string | null
          rider_id?: string | null
          route_id?: string
          service_date?: string
          status?: Database["public"]["Enums"]["trip_status"]
          total_pay?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_departed_by_fkey"
            columns: ["departed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_overview: { Args: never; Returns: Json }
      advance_order: {
        Args: {
          p_collected_via?: string
          p_kpay_proof?: string
          p_lat?: number
          p_lng?: number
          p_order_id: string
          p_proof?: string
          p_reason?: string
          p_receiver?: string
          p_to: Database["public"]["Enums"]["order_status"]
        }
        Returns: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_settlement: {
        Args: { p_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_order: {
        Args: { p_order_id: string; p_rider_id: string }
        Returns: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_trip_rider: {
        Args: { p_rider_id: string; p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      build_settlement: {
        Args: { p_date?: string; p_rider_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_settlements_for_day: {
        Args: { p_date?: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cancel_trip: {
        Args: { p_reason: string; p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claimed_role: {
        Args: { p_meta: Json }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      close_trip: {
        Args: { p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cod_by_shop: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          cod_collected: number
          cod_unreceived: number
          delivered: number
          goods_value: number
          in_transit: number
          owed_to_shop: number
          owner_name: string
          platform_fees: number
          shop_id: string
          shop_name: string
        }[]
      }
      cod_positions: {
        Args: never
        Returns: {
          adjustments: number
          base_area: string
          cod_collected: number
          cod_float_limit: number
          cod_remitted: number
          commission: number
          entry_count: number
          full_name: string
          is_active: boolean
          last_entry_at: string
          open_balance: number
          open_since: string
          phone: string
          rider_id: string
          settled_total: number
          trip_pay: number
        }[]
      }
      cod_unreceived: {
        Args: {
          p_cod: number
          p_cod_status: Database["public"]["Enums"]["cod_status"]
          p_payment: Database["public"]["Enums"]["payment_method"]
          p_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      confirm_kpay_payment: {
        Args: { p_order_id: string }
        Returns: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      depart_trip: {
        Args: { p_override_reason?: string; p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      in_service_area: {
        Args: { p_lat: number; p_lng: number }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_dispatch: { Args: never; Returns: boolean }
      is_rider: { Args: never; Returns: boolean }
      is_service_ctx: { Args: never; Returns: boolean }
      load_trip: {
        Args: { p_leg?: string; p_order_ids: string[]; p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_settlement_paid: {
        Args: { p_id: string; p_note?: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mm_day_end: { Args: { p_date: string }; Returns: string }
      mm_day_start: { Args: { p_date: string }; Returns: string }
      mm_today: { Args: never; Returns: string }
      order_attempt_count: { Args: { p_order_id: string }; Returns: number }
      order_attempts_exhausted: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      order_rider_card: { Args: { p_order_id: string }; Returns: Json }
      order_uncollected_count: { Args: { p_order_id: string }; Returns: number }
      owns_shop: { Args: { p_shop_id: string }; Returns: boolean }
      plan_trip: {
        Args: {
          p_rider_id?: string
          p_route_id: string
          p_service_date?: string
        }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      quote_trip_pay: {
        Args: { p_parcels: number; p_pickups?: number; p_route_id?: string }
        Returns: Json
      }
      reject_kpay_payment: {
        Args: { p_order_id: string; p_reason: string }
        Returns: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remit_cod: {
        Args: { p_amount: number; p_memo?: string; p_rider_id: string }
        Returns: number
      }
      reopen_settlement: {
        Args: { p_id: string; p_reason: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivery_fees: number
          gross_cod: number
          id: string
          net_due_platform: number
          notes: string | null
          order_count: number
          paid_at: string | null
          period_date: string
          platform_share: number
          rider_earnings: number
          rider_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_failed_order: {
        Args: { p_note?: string; p_order_id: string; p_resolution: string }
        Returns: {
          assign_distance_km: number | null
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          cod_amount: number
          cod_status: Database["public"]["Enums"]["cod_status"]
          code: string
          collected_via: string | null
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          customer_phone_alt: string | null
          delivered_at: string | null
          delivery_fee: number
          dropoff_address: string
          dropoff_area_id: string | null
          dropoff_geog: unknown
          dropoff_lat: number
          dropoff_lng: number
          dropoff_note: string | null
          fail_reason: string | null
          fee_payer: string
          id: string
          is_fragile: boolean
          kpay_confirmed_at: string | null
          kpay_confirmed_by: string | null
          kpay_proof_path: string | null
          kpay_reject_reason: string | null
          kpay_rejected_at: string | null
          parcel_desc: string
          parcel_value: number | null
          parcel_weight_g: number | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          picked_up_at: string | null
          pickup_address: string
          pickup_contact: string | null
          pickup_geog: unknown
          pickup_lat: number
          pickup_lng: number
          pickup_note: string | null
          platform_fee_amount: number | null
          proof_photo_path: string | null
          proof_receiver: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          rider_commission_amount: number | null
          rider_commission_pct: number | null
          rider_id: string | null
          route_distance_km: number | null
          route_id: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          trip_id: string | null
          trip_leg: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_trip: {
        Args: { p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rider_cod_in_hand: { Args: { p_rider_id: string }; Returns: number }
      rider_earnings_summary: { Args: { p_rider_id?: string }; Returns: Json }
      rider_has_work_at_shop: { Args: { p_shop_id: string }; Returns: boolean }
      rider_heartbeat: {
        Args: { p_lat?: number; p_lng?: number; p_online?: boolean }
        Returns: undefined
      }
      route_for_area: { Args: { p_area_id: string }; Returns: string }
      track_order: { Args: { p_code: string }; Returns: Json }
      unload_trip: {
        Args: { p_order_ids: string[]; p_trip_id: string }
        Returns: {
          base_pay: number
          closed_at: string | null
          created_at: string
          created_by: string | null
          depart_override_reason: string | null
          depart_parcel_count: number | null
          departed_at: string | null
          departed_by: string | null
          id: string
          notes: string | null
          parcel_count: number
          parcel_pay: number
          pay_tier_snapshot: Json | null
          pickup_count: number
          pickup_pay: number
          returned_at: string | null
          rider_id: string | null
          route_id: string
          service_date: string
          status: Database["public"]["Enums"]["trip_status"]
          total_pay: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      cod_status:
        | "none"
        | "pending"
        | "collected"
        | "remitted"
        | "settled"
        | "kpay_pending"
      ledger_kind:
        | "cod_collected"
        | "cod_remitted"
        | "commission_earned"
        | "platform_fee"
        | "adjustment"
        | "trip_pay"
      offer_response: "pending" | "accepted" | "rejected" | "expired"
      order_status:
        | "pending"
        | "assigned"
        | "picked_up"
        | "delivered"
        | "failed"
        | "cancelled"
        | "returned"
      payment_method: "cod" | "prepaid"
      rider_availability: "available" | "busy"
      settlement_status: "open" | "submitted" | "approved" | "paid"
      trip_status:
        | "planned"
        | "loading"
        | "departed"
        | "returned"
        | "closed"
        | "cancelled"
      user_role: "super_admin" | "dispatcher" | "shop_owner" | "rider"
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
      cod_status: [
        "none",
        "pending",
        "collected",
        "remitted",
        "settled",
        "kpay_pending",
      ],
      ledger_kind: [
        "cod_collected",
        "cod_remitted",
        "commission_earned",
        "platform_fee",
        "adjustment",
        "trip_pay",
      ],
      offer_response: ["pending", "accepted", "rejected", "expired"],
      order_status: [
        "pending",
        "assigned",
        "picked_up",
        "delivered",
        "failed",
        "cancelled",
        "returned",
      ],
      payment_method: ["cod", "prepaid"],
      rider_availability: ["available", "busy"],
      settlement_status: ["open", "submitted", "approved", "paid"],
      trip_status: [
        "planned",
        "loading",
        "departed",
        "returned",
        "closed",
        "cancelled",
      ],
      user_role: ["super_admin", "dispatcher", "shop_owner", "rider"],
    },
  },
} as const

