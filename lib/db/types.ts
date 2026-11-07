
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "admin_attempts": {
                  Row: {
                    "created_at": string,"id": number,"key_hash": string,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"key_hash": string,"scope": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"key_hash"?: string,"scope"?: string
                  }
                  Relationships: [
                    
                  ]
                },"admin_profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"role": Database["public"]['Enums']["admin_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string,"role": Database["public"]['Enums']["admin_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["admin_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"amenities": {
                  Row: {
                    "icon": string | null,"id": string,"name": NonNullable<Json>,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "icon"?: string | null,"id"?: string,"name": NonNullable<Json>,"sort_order"?: number
                  }
                  Update: {
                    "icon"?: string | null,"id"?: string,"name"?: NonNullable<Json>,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"entity": string,"entity_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"availability_blocks": {
                  Row: {
                    "created_at": string,"created_by": string | null,"end_date": string,"id": string,"note": string | null,"reason": Database["public"]['Enums']["block_reason"],"room_id": string,"start_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"end_date": string,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["block_reason"],"room_id": string,"start_date": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"end_date"?: string,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["block_reason"],"room_id"?: string,"start_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "availability_blocks_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"booking_reference_counters": {
                  Row: {
                    "last_value": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_value"?: number,"year": number
                  }
                  Update: {
                    "last_value"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"bookings": {
                  Row: {
                    "access_token_expires_at": string | null,"access_token_hash": string | null,"adults": number,"arrival_time": string | null,"cancellation_reason": string | null,"cancelled_at": string | null,"check_in": string,"check_out": string,"children": number,"confirmed_at": string | null,"created_at": string,"currency": string,"due_now_cents": number,"guest_country": string | null,"guest_email": string | null,"guest_id": string,"guest_name": string | null,"guest_phone": string | null,"id": string,"internal_notes": string | null,"locale": string,"marketing_consent": boolean,"price_breakdown": NonNullable<Json>,"promo_code": string | null,"reference": string | null,"room_id": string,"rules_snapshot": NonNullable<Json>,"source": Database["public"]['Enums']["booking_source"],"special_requests": string | null,"status": Database["public"]['Enums']["booking_status"],"terms_accepted_at": string | null,"terms_version": string | null,"total_cents": number,"updated_at": string,"fail_confirmation": undefined | null,"finish_confirmation": string | null,"secure_claim": boolean | null
                  }
                  ComputedFields: "fail_confirmation" | "finish_confirmation" | "secure_claim"
                  Insert: {
                    "access_token_expires_at"?: string | null,"access_token_hash"?: string | null,"adults": number,"arrival_time"?: string | null,"cancellation_reason"?: string | null,"cancelled_at"?: string | null,"check_in": string,"check_out": string,"children"?: number,"confirmed_at"?: string | null,"created_at"?: string,"currency"?: string,"due_now_cents": number,"guest_country"?: string | null,"guest_email"?: string | null,"guest_id": string,"guest_name"?: string | null,"guest_phone"?: string | null,"id"?: string,"internal_notes"?: string | null,"locale"?: string,"marketing_consent"?: boolean,"price_breakdown": NonNullable<Json>,"promo_code"?: string | null,"reference"?: string | null,"room_id": string,"rules_snapshot": NonNullable<Json>,"source"?: Database["public"]['Enums']["booking_source"],"special_requests"?: string | null,"status"?: Database["public"]['Enums']["booking_status"],"terms_accepted_at"?: string | null,"terms_version"?: string | null,"total_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "access_token_expires_at"?: string | null,"access_token_hash"?: string | null,"adults"?: number,"arrival_time"?: string | null,"cancellation_reason"?: string | null,"cancelled_at"?: string | null,"check_in"?: string,"check_out"?: string,"children"?: number,"confirmed_at"?: string | null,"created_at"?: string,"currency"?: string,"due_now_cents"?: number,"guest_country"?: string | null,"guest_email"?: string | null,"guest_id"?: string,"guest_name"?: string | null,"guest_phone"?: string | null,"id"?: string,"internal_notes"?: string | null,"locale"?: string,"marketing_consent"?: boolean,"price_breakdown"?: NonNullable<Json>,"promo_code"?: string | null,"reference"?: string | null,"room_id"?: string,"rules_snapshot"?: NonNullable<Json>,"source"?: Database["public"]['Enums']["booking_source"],"special_requests"?: string | null,"status"?: Database["public"]['Enums']["booking_status"],"terms_accepted_at"?: string | null,"terms_version"?: string | null,"total_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_guest_id_fkey"
      columns: ["guest_id"]
isOneToOne: false
      referencedRelation: "guests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"cancellation_policies": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"is_default": boolean,"is_non_refundable": boolean,"name": NonNullable<Json>,"tiers": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"is_non_refundable"?: boolean,"name": NonNullable<Json>,"tiers": NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"is_default"?: boolean,"is_non_refundable"?: boolean,"name"?: NonNullable<Json>,"tiers"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"consent_log": {
                  Row: {
                    "created_at": string,"granted": boolean,"id": number,"kind": string,"policy_version": string | null,"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"granted": boolean,"id"?: never,"kind": string,"policy_version"?: string | null,"subject"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"granted"?: boolean,"id"?: never,"kind"?: string,"policy_version"?: string | null,"subject"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"contact_messages": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"dates_of_interest": string | null,"email": string,"id": string,"is_read": boolean,"locale": string,"message": string,"name": string,"phone": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"dates_of_interest"?: string | null,"email": string,"id"?: string,"is_read"?: boolean,"locale"?: string,"message": string,"name": string,"phone"?: string | null,"status"?: string
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"dates_of_interest"?: string | null,"email"?: string,"id"?: string,"is_read"?: boolean,"locale"?: string,"message"?: string,"name"?: string,"phone"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_messages_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"content_blocks": {
                  Row: {
                    "draft": NonNullable<Json>,"id": string,"key": string,"page_id": string,"published": Json | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "draft"?: NonNullable<Json>,"id"?: string,"key": string,"page_id": string,"published"?: Json | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "draft"?: NonNullable<Json>,"id"?: string,"key"?: string,"page_id"?: string,"published"?: Json | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_blocks_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "pages"
      referencedColumns: ["id"]
    }
                  ]
                },"email_logs": {
                  Row: {
                    "attempts": number,"booking_id": string | null,"contact_message_id": string | null,"created_at": string,"id": string,"last_error": string | null,"locale": string,"next_attempt_at": string,"payload": NonNullable<Json>,"recipient": string,"resend_id": string | null,"sent_at": string | null,"status": string,"template_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"booking_id"?: string | null,"contact_message_id"?: string | null,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locale"?: string,"next_attempt_at"?: string,"payload"?: NonNullable<Json>,"recipient": string,"resend_id"?: string | null,"sent_at"?: string | null,"status"?: string,"template_key": string
                  }
                  Update: {
                    "attempts"?: number,"booking_id"?: string | null,"contact_message_id"?: string | null,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locale"?: string,"next_attempt_at"?: string,"payload"?: NonNullable<Json>,"recipient"?: string,"resend_id"?: string | null,"sent_at"?: string | null,"status"?: string,"template_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_logs_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_logs_contact_message_id_fkey"
      columns: ["contact_message_id"]
isOneToOne: false
      referencedRelation: "contact_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"email_templates": {
                  Row: {
                    "body": string,"key": string,"locale": string,"subject": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"key": string,"locale": string,"subject": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"key"?: string,"locale"?: string,"subject"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"external_calendars": {
                  Row: {
                    "channel": Database["public"]['Enums']["channel"],"consecutive_failures": number,"created_at": string,"id": string,"import_url": string | null,"is_enabled": boolean,"last_synced_at": string | null,"room_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": Database["public"]['Enums']["channel"],"consecutive_failures"?: number,"created_at"?: string,"id"?: string,"import_url"?: string | null,"is_enabled"?: boolean,"last_synced_at"?: string | null,"room_id": string,"updated_at"?: string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["channel"],"consecutive_failures"?: number,"created_at"?: string,"id"?: string,"import_url"?: string | null,"is_enabled"?: boolean,"last_synced_at"?: string | null,"room_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "external_calendars_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"external_events": {
                  Row: {
                    "amount_cents": number | null,"calendar_id": string,"created_at": string,"details_updated_at": string | null,"end_date": string,"guest_email": string | null,"guest_name": string | null,"guest_notes": string | null,"guest_phone": string | null,"id": string,"start_date": string,"summary": string | null,"uid": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"calendar_id": string,"created_at"?: string,"details_updated_at"?: string | null,"end_date": string,"guest_email"?: string | null,"guest_name"?: string | null,"guest_notes"?: string | null,"guest_phone"?: string | null,"id"?: string,"start_date": string,"summary"?: string | null,"uid": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number | null,"calendar_id"?: string,"created_at"?: string,"details_updated_at"?: string | null,"end_date"?: string,"guest_email"?: string | null,"guest_name"?: string | null,"guest_notes"?: string | null,"guest_phone"?: string | null,"id"?: string,"start_date"?: string,"summary"?: string | null,"uid"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "external_events_calendar_id_fkey"
      columns: ["calendar_id"]
isOneToOne: false
      referencedRelation: "external_calendars"
      referencedColumns: ["id"]
    }
                  ]
                },"faq": {
                  Row: {
                    "answer": NonNullable<Json>,"id": string,"question": NonNullable<Json>,"sort_order": number,"status": Database["public"]['Enums']["publish_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": NonNullable<Json>,"id"?: string,"question": NonNullable<Json>,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"id"?: string,"question"?: NonNullable<Json>,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Relationships: [
                    
                  ]
                },"guests": {
                  Row: {
                    "anonymized_at": string | null,"country": string | null,"created_at": string,"email": string | null,"full_name": string | null,"id": string,"locale": string,"marketing_consent": boolean,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anonymized_at"?: string | null,"country"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id"?: string,"locale"?: string,"marketing_consent"?: boolean,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "anonymized_at"?: string | null,"country"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id"?: string,"locale"?: string,"marketing_consent"?: boolean,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"holds": {
                  Row: {
                    "booking_id": string,"created_at": string,"expires_at": string,"id": string,"stripe_checkout_session_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id": string,"created_at"?: string,"expires_at": string,"id"?: string,"stripe_checkout_session_id"?: string | null
                  }
                  Update: {
                    "booking_id"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"stripe_checkout_session_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "holds_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: true
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"ical_export_tokens": {
                  Row: {
                    "room_id": string,"rotated_at": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "room_id": string,"rotated_at"?: string,"token_hash": string
                  }
                  Update: {
                    "room_id"?: string,"rotated_at"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ical_export_tokens_room_id_fkey"
      columns: ["room_id"]
isOneToOne: true
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_claims": {
                  Row: {
                    "block_id": string | null,"booking_id": string | null,"created_at": string,"external_event_id": string | null,"id": string,"is_conflicted": boolean,"kind": Database["public"]['Enums']["claim_kind"],"room_id": string,"stay": unknown
                  }
                  ComputedFields: never
                  Insert: {
                    "block_id"?: string | null,"booking_id"?: string | null,"created_at"?: string,"external_event_id"?: string | null,"id"?: string,"is_conflicted"?: boolean,"kind": Database["public"]['Enums']["claim_kind"],"room_id": string,"stay": unknown
                  }
                  Update: {
                    "block_id"?: string | null,"booking_id"?: string | null,"created_at"?: string,"external_event_id"?: string | null,"id"?: string,"is_conflicted"?: boolean,"kind"?: Database["public"]['Enums']["claim_kind"],"room_id"?: string,"stay"?: unknown
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_claims_block_id_fkey"
      columns: ["block_id"]
isOneToOne: true
      referencedRelation: "availability_blocks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_claims_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: true
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_claims_external_event_id_fkey"
      columns: ["external_event_id"]
isOneToOne: true
      referencedRelation: "external_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_claims_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_lines": {
                  Row: {
                    "description": string,"id": string,"invoice_id": string,"kind": string,"quantity": number,"sort_order": number,"total_cents": number,"unit_cents": number,"vat_basis_points": number,"vat_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"id"?: string,"invoice_id": string,"kind"?: string,"quantity"?: number,"sort_order"?: number,"total_cents": number,"unit_cents": number,"vat_basis_points"?: number,"vat_cents"?: number
                  }
                  Update: {
                    "description"?: string,"id"?: string,"invoice_id"?: string,"kind"?: string,"quantity"?: number,"sort_order"?: number,"total_cents"?: number,"unit_cents"?: number,"vat_basis_points"?: number,"vat_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_lines_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_series": {
                  Row: {
                    "doc_type": Database["public"]['Enums']["invoice_doc_type"],"id": string,"is_active": boolean,"last_number": number,"prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "doc_type": Database["public"]['Enums']["invoice_doc_type"],"id"?: string,"is_active"?: boolean,"last_number"?: number,"prefix": string
                  }
                  Update: {
                    "doc_type"?: Database["public"]['Enums']["invoice_doc_type"],"id"?: string,"is_active"?: boolean,"last_number"?: number,"prefix"?: string
                  }
                  Relationships: [
                    
                  ]
                },"invoices": {
                  Row: {
                    "booking_id": string | null,"created_at": string,"credits_invoice_id": string | null,"customer": NonNullable<Json>,"doc_type": Database["public"]['Enums']["invoice_doc_type"],"document_number": string | null,"exported_at": string | null,"fee_cents": number,"id": string,"is_provisional": boolean,"issued_at": string | null,"issued_by": string | null,"issuer": NonNullable<Json>,"mydata": Json | null,"net_cents": number,"number": number | null,"payment_id": string | null,"payment_method": Database["public"]['Enums']["payment_method"] | null,"pdf_path": string | null,"reason": string | null,"series_id": string | null,"status": Database["public"]['Enums']["invoice_status"],"total_cents": number,"vat_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"created_at"?: string,"credits_invoice_id"?: string | null,"customer"?: NonNullable<Json>,"doc_type": Database["public"]['Enums']["invoice_doc_type"],"document_number"?: string | null,"exported_at"?: string | null,"fee_cents"?: number,"id"?: string,"is_provisional"?: boolean,"issued_at"?: string | null,"issued_by"?: string | null,"issuer"?: NonNullable<Json>,"mydata"?: Json | null,"net_cents"?: number,"number"?: number | null,"payment_id"?: string | null,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"pdf_path"?: string | null,"reason"?: string | null,"series_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_cents"?: number,"vat_cents"?: number
                  }
                  Update: {
                    "booking_id"?: string | null,"created_at"?: string,"credits_invoice_id"?: string | null,"customer"?: NonNullable<Json>,"doc_type"?: Database["public"]['Enums']["invoice_doc_type"],"document_number"?: string | null,"exported_at"?: string | null,"fee_cents"?: number,"id"?: string,"is_provisional"?: boolean,"issued_at"?: string | null,"issued_by"?: string | null,"issuer"?: NonNullable<Json>,"mydata"?: Json | null,"net_cents"?: number,"number"?: number | null,"payment_id"?: string | null,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"pdf_path"?: string | null,"reason"?: string | null,"series_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_cents"?: number,"vat_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_credits_invoice_id_fkey"
      columns: ["credits_invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "invoice_series"
      referencedColumns: ["id"]
    }
                  ]
                },"job_runs": {
                  Row: {
                    "detail": string | null,"finished_at": string | null,"id": number,"job": string,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "detail"?: string | null,"finished_at"?: string | null,"id"?: never,"job": string,"started_at"?: string,"status"?: string
                  }
                  Update: {
                    "detail"?: string | null,"finished_at"?: string | null,"id"?: never,"job"?: string,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"media": {
                  Row: {
                    "alt": NonNullable<Json>,"bucket": string,"created_at": string,"created_by": string | null,"height": number | null,"id": string,"mime_type": string,"path": string,"size_bytes": number | null,"updated_at": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "alt"?: NonNullable<Json>,"bucket"?: string,"created_at"?: string,"created_by"?: string | null,"height"?: number | null,"id"?: string,"mime_type": string,"path": string,"size_bytes"?: number | null,"updated_at"?: string,"width"?: number | null
                  }
                  Update: {
                    "alt"?: NonNullable<Json>,"bucket"?: string,"created_at"?: string,"created_by"?: string | null,"height"?: number | null,"id"?: string,"mime_type"?: string,"path"?: string,"size_bytes"?: number | null,"updated_at"?: string,"width"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"media_placements": {
                  Row: {
                    "collection": string,"created_at": string,"id": string,"is_cover": boolean,"media_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "collection": string,"created_at"?: string,"id"?: string,"is_cover"?: boolean,"media_id": string,"sort_order"?: number
                  }
                  Update: {
                    "collection"?: string,"created_at"?: string,"id"?: string,"is_cover"?: boolean,"media_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_placements_media_id_fkey"
      columns: ["media_id"]
isOneToOne: false
      referencedRelation: "media"
      referencedColumns: ["id"]
    }
                  ]
                },"pages": {
                  Row: {
                    "id": string,"published_at": string | null,"seo": NonNullable<Json>,"slug": string,"status": Database["public"]['Enums']["publish_status"],"title": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"published_at"?: string | null,"seo"?: NonNullable<Json>,"slug": string,"status"?: Database["public"]['Enums']["publish_status"],"title"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"published_at"?: string | null,"seo"?: NonNullable<Json>,"slug"?: string,"status"?: Database["public"]['Enums']["publish_status"],"title"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"booking_id": string,"created_at": string,"id": string,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"],"note": string | null,"paid_at": string | null,"recorded_by": string | null,"status": Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id": string | null,"stripe_payment_intent_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"booking_id": string,"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["payment_kind"],"method": Database["public"]['Enums']["payment_method"],"note"?: string | null,"paid_at"?: string | null,"recorded_by"?: string | null,"status": Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id"?: string | null,"stripe_payment_intent_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"booking_id"?: string,"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["payment_kind"],"method"?: Database["public"]['Enums']["payment_method"],"note"?: string | null,"paid_at"?: string | null,"recorded_by"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"stripe_checkout_session_id"?: string | null,"stripe_payment_intent_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    }
                  ]
                },"places": {
                  Row: {
                    "description": NonNullable<Json>,"id": string,"media_id": string | null,"name": NonNullable<Json>,"sort_order": number,"status": Database["public"]['Enums']["publish_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: NonNullable<Json>,"id"?: string,"media_id"?: string | null,"name": NonNullable<Json>,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Update: {
                    "description"?: NonNullable<Json>,"id"?: string,"media_id"?: string | null,"name"?: NonNullable<Json>,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "places_media_id_fkey"
      columns: ["media_id"]
isOneToOne: false
      referencedRelation: "media"
      referencedColumns: ["id"]
    }
                  ]
                },"promo_codes": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["promo_kind"],"max_uses": number | null,"room_ids": (string)[] | null,"used_count": number,"valid_from": string | null,"valid_to": string | null,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["promo_kind"],"max_uses"?: number | null,"room_ids"?: (string)[] | null,"used_count"?: number,"valid_from"?: string | null,"valid_to"?: string | null,"value": number
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["promo_kind"],"max_uses"?: number | null,"room_ids"?: (string)[] | null,"used_count"?: number,"valid_from"?: string | null,"valid_to"?: string | null,"value"?: number
                  }
                  Relationships: [
                    
                  ]
                },"property": {
                  Row: {
                    "address": string | null,"check_in_time": string,"check_out_time": string,"email": string | null,"id": boolean,"legal_name": string | null,"name": string,"phone": string | null,"registration_number": string | null,"social_links": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"check_in_time"?: string,"check_out_time"?: string,"email"?: string | null,"id"?: boolean,"legal_name"?: string | null,"name": string,"phone"?: string | null,"registration_number"?: string | null,"social_links"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"check_in_time"?: string,"check_out_time"?: string,"email"?: string | null,"id"?: boolean,"legal_name"?: string | null,"name"?: string,"phone"?: string | null,"registration_number"?: string | null,"social_links"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_overrides": {
                  Row: {
                    "night": string,"nightly_cents": number,"room_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "night": string,"nightly_cents": number,"room_id": string
                  }
                  Update: {
                    "night"?: string,"nightly_cents"?: number,"room_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rate_overrides_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"refunds": {
                  Row: {
                    "amount_cents": number,"booking_id": string,"created_at": string,"id": string,"payment_id": string,"reason": string | null,"recorded_by": string | null,"settled_at": string | null,"status": Database["public"]['Enums']["refund_status"],"stripe_refund_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"booking_id": string,"created_at"?: string,"id"?: string,"payment_id": string,"reason"?: string | null,"recorded_by"?: string | null,"settled_at"?: string | null,"status": Database["public"]['Enums']["refund_status"],"stripe_refund_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"booking_id"?: string,"created_at"?: string,"id"?: string,"payment_id"?: string,"reason"?: string | null,"recorded_by"?: string | null,"settled_at"?: string | null,"status"?: Database["public"]['Enums']["refund_status"],"stripe_refund_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"restrictions": {
                  Row: {
                    "allowed_check_in_days": (number)[] | null,"closed_to_arrival": boolean,"closed_to_departure": boolean,"end_date": string,"id": string,"max_stay": number | null,"min_stay": number | null,"room_id": string,"start_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_check_in_days"?: (number)[] | null,"closed_to_arrival"?: boolean,"closed_to_departure"?: boolean,"end_date": string,"id"?: string,"max_stay"?: number | null,"min_stay"?: number | null,"room_id": string,"start_date": string
                  }
                  Update: {
                    "allowed_check_in_days"?: (number)[] | null,"closed_to_arrival"?: boolean,"closed_to_departure"?: boolean,"end_date"?: string,"id"?: string,"max_stay"?: number | null,"min_stay"?: number | null,"room_id"?: string,"start_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restrictions_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"room_amenities": {
                  Row: {
                    "amenity_id": string,"room_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amenity_id": string,"room_id": string
                  }
                  Update: {
                    "amenity_id"?: string,"room_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_amenities_amenity_id_fkey"
      columns: ["amenity_id"]
isOneToOne: false
      referencedRelation: "amenities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_amenities_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"rooms": {
                  Row: {
                    "base_occupancy": number,"base_price_cents": number,"cleaning_fee_cents": number,"created_at": string,"description": NonNullable<Json>,"extra_guest_fee_cents": number,"id": string,"is_active": boolean,"max_adults": number,"max_children": number,"name": NonNullable<Json>,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_occupancy": number,"base_price_cents": number,"cleaning_fee_cents"?: number,"created_at"?: string,"description"?: NonNullable<Json>,"extra_guest_fee_cents"?: number,"id"?: string,"is_active"?: boolean,"max_adults": number,"max_children"?: number,"name": NonNullable<Json>,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "base_occupancy"?: number,"base_price_cents"?: number,"cleaning_fee_cents"?: number,"created_at"?: string,"description"?: NonNullable<Json>,"extra_guest_fee_cents"?: number,"id"?: string,"is_active"?: boolean,"max_adults"?: number,"max_children"?: number,"name"?: NonNullable<Json>,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"seasons": {
                  Row: {
                    "end_date": string,"id": string,"name": string,"nightly_cents": number,"room_id": string,"start_date": string,"weekend_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "end_date": string,"id"?: string,"name": string,"nightly_cents": number,"room_id": string,"start_date": string,"weekend_cents"?: number | null
                  }
                  Update: {
                    "end_date"?: string,"id"?: string,"name"?: string,"nightly_cents"?: number,"room_id"?: string,"start_date"?: string,"weekend_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "seasons_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "is_public": boolean,"key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "is_public"?: boolean,"key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "is_public"?: boolean,"key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"stripe_events": {
                  Row: {
                    "error": string | null,"id": string,"payload": NonNullable<Json>,"processed_at": string | null,"received_at": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error"?: string | null,"id": string,"payload": NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"type": string
                  }
                  Update: {
                    "error"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sync_logs": {
                  Row: {
                    "calendar_id": string,"error": string | null,"events_seen": number | null,"finished_at": string | null,"id": number,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calendar_id": string,"error"?: string | null,"events_seen"?: number | null,"finished_at"?: string | null,"id"?: never,"started_at"?: string,"status": string
                  }
                  Update: {
                    "calendar_id"?: string,"error"?: string | null,"events_seen"?: number | null,"finished_at"?: string | null,"id"?: never,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_logs_calendar_id_fkey"
      columns: ["calendar_id"]
isOneToOne: false
      referencedRelation: "external_calendars"
      referencedColumns: ["id"]
    }
                  ]
                },"taxes_fees": {
                  Row: {
                    "amount_cents": number | null,"id": string,"is_active": boolean,"is_vat": boolean,"kind": Database["public"]['Enums']["fee_kind"],"name": NonNullable<Json>,"rate_basis_points": number | null,"sort_order": number,"valid_from": string | null,"valid_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"id"?: string,"is_active"?: boolean,"is_vat"?: boolean,"kind": Database["public"]['Enums']["fee_kind"],"name": NonNullable<Json>,"rate_basis_points"?: number | null,"sort_order"?: number,"valid_from"?: string | null,"valid_to"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"id"?: string,"is_active"?: boolean,"is_vat"?: boolean,"kind"?: Database["public"]['Enums']["fee_kind"],"name"?: NonNullable<Json>,"rate_basis_points"?: number | null,"sort_order"?: number,"valid_from"?: string | null,"valid_to"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"testimonials": {
                  Row: {
                    "author": string,"body": NonNullable<Json>,"id": string,"sort_order": number,"status": Database["public"]['Enums']["publish_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "author": string,"body": NonNullable<Json>,"id"?: string,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Update: {
                    "author"?: string,"body"?: NonNullable<Json>,"id"?: string,"sort_order"?: number,"status"?: Database["public"]['Enums']["publish_status"]
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "assert_room_sellable":
{ Args: { "p_room_id": string,"p_stay": unknown }; Returns: undefined
                           },
"attach_checkout_session":
{ Args: { "p_booking_id": string,"p_session_id": string }; Returns: undefined
                           },
"attach_invoice_pdf":
{ Args: { "p_actor"?: string,"p_invoice_id": string,"p_path": string }; Returns: undefined
                           },
"booking_for_token":
{ Args: { "p_token": string }; Returns: Json
                           },
"cancel_booking":
{ Args: { "p_actor"?: string,"p_booking_id": string,"p_reason"?: string }; Returns: Json
                           },
"complete_finished_bookings":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"confirm_booking":
{ Args: { "p_amount_cents": number,"p_booking_id": string,"p_checkout_session_id": string,"p_kind": Database["public"]['Enums']["payment_kind"],"p_payment_intent_id": string }; Returns: Json
                           },
"confirm_without_payment":
{ Args: { "p_booking_id": string }; Returns: Json
                           },
"create_block":
{ Args: { "p_created_by"?: string,"p_end": string,"p_note"?: string,"p_reason": Database["public"]['Enums']["block_reason"],"p_room_id": string,"p_start": string }; Returns: string
                           },
"create_hold":
{ Args: { "p_adults": number,"p_check_in": string,"p_check_out": string,"p_children": number,"p_due_now_cents": number,"p_guest": Json,"p_hold_minutes"?: number,"p_price_breakdown": Json,"p_promo_code"?: string,"p_room_id": string,"p_rules_snapshot": Json,"p_terms_version": string,"p_token_expires_at": string,"p_token_hash": string,"p_total_cents": number }; Returns: Json
                           },
"create_manual_booking":
{ Args: { "p_actor"?: string,"p_adults": number,"p_check_in": string,"p_check_out": string,"p_children": number,"p_guest": Json,"p_internal_notes"?: string,"p_price_breakdown": Json,"p_room_id": string,"p_rules_snapshot": Json,"p_source"?: Database["public"]['Enums']["booking_source"],"p_token_expires_at"?: string,"p_token_hash"?: string,"p_total_cents": number }; Returns: Json
                           },
"current_admin_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["admin_role"]
                           },
"fail_confirmation":
{ Args: { "p_booking": Omit<Database["public"]['Tables']["bookings"]['Row'], Database["public"]['Tables']["bookings"]['ComputedFields']> }; Returns: undefined
                           },
"find_or_create_guest":
{ Args: { "p_guest": Json }; Returns: string
                           },
"finish_confirmation":
{ Args: { "p_booking": Omit<Database["public"]['Tables']["bookings"]['Row'], Database["public"]['Tables']["bookings"]['ComputedFields']> }; Returns: string
                           },
"finish_invoice":
{ Args: { "p_actor": string,"p_doc_type": Database["public"]['Enums']["invoice_doc_type"],"p_invoice_id": string }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"issue_credit_note":
{ Args: { "p_actor"?: string,"p_expected_credited_cents": number,"p_invoice_id": string,"p_lines": Json,"p_reason": string }; Returns: Json
                           },
"issue_invoice":
{ Args: { "p_actor"?: string,"p_booking_id": string,"p_customer": Json,"p_doc_type": Database["public"]['Enums']["invoice_doc_type"],"p_lines": Json,"p_payment_id"?: string,"p_payment_method"?: Database["public"]['Enums']["payment_method"] }; Returns: Json
                           },
"lock_room":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"mark_invoices_exported":
{ Args: { "p_actor"?: string,"p_invoice_ids": (string)[] }; Returns: number
                           },
"modify_booking":
{ Args: { "p_actor"?: string,"p_booking_id": string,"p_check_in": string,"p_check_out": string,"p_price_breakdown": Json,"p_room_id": string,"p_token_expires_at"?: string,"p_total_cents": number }; Returns: undefined
                           },
"next_booking_reference":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"next_invoice_number":
{ Args: { "p_series_id": string }; Returns: number
                           },
"public_availability":
{ Args: { "p_from": string,"p_room_id": string,"p_to": string }; Returns: {
              "is_available": boolean,"night": string
            }[]
                           },
"purge_admin_attempts":
{ Args: { "p_older_than"?: string }; Returns: number
                           },
"record_payment":
{ Args: { "p_amount_cents": number,"p_booking_id": string,"p_kind": Database["public"]['Enums']["payment_kind"],"p_method": Database["public"]['Enums']["payment_method"],"p_note"?: string,"p_payment_intent_id"?: string,"p_recorded_by"?: string }; Returns: string
                           },
"record_refund":
{ Args: { "p_amount_cents": number,"p_booking_id": string,"p_payment_id": string,"p_reason"?: string,"p_recorded_by"?: string,"p_stripe_refund_id"?: string }; Returns: string
                           },
"release_expired_holds":
{ Args: { "p_room_id"?: string,"p_stay"?: unknown }; Returns: number
                           },
"release_promo":
{ Args: { "p_code": string }; Returns: undefined
                           },
"remove_block":
{ Args: { "p_actor"?: string,"p_block_id": string }; Returns: undefined
                           },
"remove_missing_external_events":
{ Args: { "p_allow_empty"?: boolean,"p_calendar_id": string,"p_seen_uids": (string)[] }; Returns: number
                           },
"reserve_refund":
{ Args: { "p_actor"?: string,"p_amount_cents": number,"p_booking_id": string,"p_payment_id": string,"p_reason"?: string }; Returns: string
                           },
"save_rules":
{ Args: { "p_actor"?: string,"p_is_non_refundable": boolean,"p_payment": Json,"p_tiers": Json }; Returns: undefined
                           },
"secure_claim":
{ Args: { "p_booking": Omit<Database["public"]['Tables']["bookings"]['Row'], Database["public"]['Tables']["bookings"]['ComputedFields']> }; Returns: boolean
                           },
"set_actor":
{ Args: { "p_actor": string }; Returns: undefined
                           },
"settle_refund":
{ Args: { "p_refund_id": string,"p_status": Database["public"]['Enums']["refund_status"],"p_stripe_refund_id"?: string }; Returns: undefined
                           },
"sync_refunded_status":
{ Args: { "p_booking_id": string }; Returns: undefined
                           },
"transition_booking":
{ Args: { "p_actor"?: string,"p_booking_id": string,"p_status": Database["public"]['Enums']["booking_status"] }; Returns: undefined
                           },
"update_booking_notes":
{ Args: { "p_actor"?: string,"p_booking_id": string,"p_notes": string }; Returns: undefined
                           },
"update_external_event_details":
{ Args: { "p_actor"?: string,"p_amount_cents": number,"p_event_id": string,"p_guest_email": string,"p_guest_name": string,"p_guest_notes": string,"p_guest_phone": string,"p_update_amount"?: boolean }; Returns: undefined
                           },
"upsert_external_event":
{ Args: { "p_calendar_id": string,"p_end": string,"p_start": string,"p_summary"?: string,"p_uid": string }; Returns: Json
                           },
"write_invoice_lines":
{ Args: { "p_invoice_id": string,"p_lines": Json }; Returns: undefined
                           }
          }
          Enums: {
            "admin_role": "owner"|"staff","block_reason": "maintenance"|"owner_use"|"closed_period"|"other","booking_source": "direct"|"manual"|"booking_com"|"airbnb"|"other","booking_status": "pending_payment"|"confirmed"|"checked_in"|"completed"|"cancelled"|"expired"|"refunded"|"no_show","channel": "airbnb"|"booking_com"|"other_ical","claim_kind": "hold"|"booking"|"block"|"external","fee_kind": "percent"|"per_stay"|"per_night"|"per_guest_night","invoice_doc_type": "receipt"|"invoice"|"credit_note","invoice_status": "draft"|"issued","payment_kind": "full"|"deposit"|"balance"|"extra","payment_method": "card"|"cash"|"bank_transfer"|"pos","payment_status": "pending"|"succeeded"|"failed"|"disputed","promo_kind": "percent"|"fixed","publish_status": "draft"|"published","refund_status": "pending"|"succeeded"|"failed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "admin_role": ["owner", "staff"],"block_reason": ["maintenance", "owner_use", "closed_period", "other"],"booking_source": ["direct", "manual", "booking_com", "airbnb", "other"],"booking_status": ["pending_payment", "confirmed", "checked_in", "completed", "cancelled", "expired", "refunded", "no_show"],"channel": ["airbnb", "booking_com", "other_ical"],"claim_kind": ["hold", "booking", "block", "external"],"fee_kind": ["percent", "per_stay", "per_night", "per_guest_night"],"invoice_doc_type": ["receipt", "invoice", "credit_note"],"invoice_status": ["draft", "issued"],"payment_kind": ["full", "deposit", "balance", "extra"],"payment_method": ["card", "cash", "bank_transfer", "pos"],"payment_status": ["pending", "succeeded", "failed", "disputed"],"promo_kind": ["percent", "fixed"],"publish_status": ["draft", "published"],"refund_status": ["pending", "succeeded", "failed"]
          }
        }
} as const
