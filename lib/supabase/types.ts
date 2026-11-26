export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_messages: {
        Row: {
          content: Json
          created_at: string | null
          from_agent: string
          id: string
          message_type: string
          parent_id: string | null
          product_id: string
          responded_at: string | null
          response_content: Json | null
          status: string
          subject: string | null
          thread_id: string
          to_agent: string
        }
        Insert: {
          content: Json
          created_at?: string | null
          from_agent: string
          id?: string
          message_type?: string
          parent_id?: string | null
          product_id: string
          responded_at?: string | null
          response_content?: Json | null
          status?: string
          subject?: string | null
          thread_id?: string
          to_agent: string
        }
        Update: {
          content?: Json
          created_at?: string | null
          from_agent?: string
          id?: string
          message_type?: string
          parent_id?: string | null
          product_id?: string
          responded_at?: string | null
          response_content?: Json | null
          status?: string
          subject?: string | null
          thread_id?: string
          to_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_outputs: {
        Row: {
          agent_name: string
          content_json: Json
          created_at: string | null
          id: string
          output_type: string
          product_id: string
          run_id: string | null
          status: string | null
        }
        Insert: {
          agent_name: string
          content_json?: Json
          created_at?: string | null
          id?: string
          output_type: string
          product_id: string
          run_id?: string | null
          status?: string | null
        }
        Update: {
          agent_name?: string
          content_json?: Json
          created_at?: string | null
          id?: string
          output_type?: string
          product_id?: string
          run_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_outputs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          completed_at: string | null
          current_phase: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          product_id: string
          progress_percent: number | null
          run_type: string
          started_at: string | null
          status: string | null
          updated_at: string | null
          warnings: Json | null
        }
        Insert: {
          completed_at?: string | null
          current_phase?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          product_id: string
          progress_percent?: number | null
          run_type: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          warnings?: Json | null
        }
        Update: {
          completed_at?: string | null
          current_phase?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          product_id?: string
          progress_percent?: number | null
          run_type?: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ambassadors: {
        Row: {
          audience_overlap_score: number | null
          compensation_model: string | null
          content_json: Json | null
          content_type: string | null
          created_at: string | null
          follower_count: number | null
          handle_or_email: string | null
          id: string
          name: string
          notes: string | null
          outreach_template: string | null
          platform: string | null
          product_id: string
          status: string | null
        }
        Insert: {
          audience_overlap_score?: number | null
          compensation_model?: string | null
          content_json?: Json | null
          content_type?: string | null
          created_at?: string | null
          follower_count?: number | null
          handle_or_email?: string | null
          id?: string
          name: string
          notes?: string | null
          outreach_template?: string | null
          platform?: string | null
          product_id: string
          status?: string | null
        }
        Update: {
          audience_overlap_score?: number | null
          compensation_model?: string | null
          content_json?: Json | null
          content_type?: string | null
          created_at?: string | null
          follower_count?: number | null
          handle_or_email?: string | null
          id?: string
          name?: string
          notes?: string | null
          outreach_template?: string | null
          platform?: string | null
          product_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ambassadors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_reports: {
        Row: {
          created_at: string | null
          data_source: string
          id: string
          insights_json: Json | null
          metrics_json: Json | null
          period_end: string | null
          period_start: string | null
          product_id: string
          recommendations_json: Json | null
        }
        Insert: {
          created_at?: string | null
          data_source?: string
          id?: string
          insights_json?: Json | null
          metrics_json?: Json | null
          period_end?: string | null
          period_start?: string | null
          product_id: string
          recommendations_json?: Json | null
        }
        Update: {
          created_at?: string | null
          data_source?: string
          id?: string
          insights_json?: Json | null
          metrics_json?: Json | null
          period_end?: string | null
          period_start?: string | null
          product_id?: string
          recommendations_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          agent_name: string
          approved_at: string | null
          created_at: string | null
          edited_content: Json | null
          full_content_json: Json
          id: string
          output_type: string
          preview_text: string | null
          product_id: string
          rejected_at: string | null
          reviewed_at: string | null
          status: string | null
          title: string
        }
        Insert: {
          agent_name: string
          approved_at?: string | null
          created_at?: string | null
          edited_content?: Json | null
          full_content_json?: Json
          id?: string
          output_type: string
          preview_text?: string | null
          product_id: string
          rejected_at?: string | null
          reviewed_at?: string | null
          status?: string | null
          title: string
        }
        Update: {
          agent_name?: string
          approved_at?: string | null
          created_at?: string | null
          edited_content?: Json | null
          full_content_json?: Json
          id?: string
          output_type?: string
          preview_text?: string | null
          product_id?: string
          rejected_at?: string | null
          reviewed_at?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ad_copies_json: Json | null
          budget: number | null
          campaign_type: string | null
          created_at: string | null
          id: string
          objective: string | null
          performance_json: Json | null
          platform: string
          product_id: string
          status: string | null
          targeting_json: Json | null
        }
        Insert: {
          ad_copies_json?: Json | null
          budget?: number | null
          campaign_type?: string | null
          created_at?: string | null
          id?: string
          objective?: string | null
          performance_json?: Json | null
          platform: string
          product_id: string
          status?: string | null
          targeting_json?: Json | null
        }
        Update: {
          ad_copies_json?: Json | null
          budget?: number | null
          campaign_type?: string | null
          created_at?: string | null
          id?: string
          objective?: string | null
          performance_json?: Json | null
          platform?: string
          product_id?: string
          status?: string | null
          targeting_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      community_groups: {
        Row: {
          content_json: Json | null
          created_at: string | null
          description: string | null
          engagement_score: number | null
          fit_score: number | null
          id: string
          member_count: string | null
          name: string
          notes: string | null
          platform: string
          product_id: string
          status: string | null
          url: string | null
        }
        Insert: {
          content_json?: Json | null
          created_at?: string | null
          description?: string | null
          engagement_score?: number | null
          fit_score?: number | null
          id?: string
          member_count?: string | null
          name: string
          notes?: string | null
          platform: string
          product_id: string
          status?: string | null
          url?: string | null
        }
        Update: {
          content_json?: Json | null
          created_at?: string | null
          description?: string | null
          engagement_score?: number | null
          fit_score?: number | null
          id?: string
          member_count?: string | null
          name?: string
          notes?: string | null
          platform?: string
          product_id?: string
          status?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          approval_id: string | null
          body: string | null
          content_type: string | null
          created_at: string | null
          hashtags: string[] | null
          id: string
          media_urls: string[] | null
          performance_json: Json | null
          platform: string
          product_id: string
          published_at: string | null
          scheduled_at: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          approval_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          media_urls?: string[] | null
          performance_json?: Json | null
          platform: string
          product_id: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          approval_id?: string | null
          body?: string | null
          content_type?: string | null
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          media_urls?: string[] | null
          performance_json?: Json | null
          platform?: string
          product_id?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_images: {
        Row: {
          agent_name: string
          content_type: string | null
          copy_direction: string | null
          created_at: string | null
          design_brief: string | null
          error_message: string | null
          height: number | null
          id: string
          image_url: string | null
          model: string
          negative_prompt: string | null
          platform: string | null
          product_id: string
          prompt: string
          status: string
          title: string | null
          width: number | null
        }
        Insert: {
          agent_name?: string
          content_type?: string | null
          copy_direction?: string | null
          created_at?: string | null
          design_brief?: string | null
          error_message?: string | null
          height?: number | null
          id?: string
          image_url?: string | null
          model?: string
          negative_prompt?: string | null
          platform?: string | null
          product_id: string
          prompt: string
          status?: string
          title?: string | null
          width?: number | null
        }
        Update: {
          agent_name?: string
          content_type?: string | null
          copy_direction?: string | null
          created_at?: string | null
          design_brief?: string | null
          error_message?: string | null
          height?: number | null
          id?: string
          image_url?: string | null
          model?: string
          negative_prompt?: string | null
          platform?: string | null
          product_id?: string
          prompt?: string
          status?: string
          title?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          id: string
          message: string | null
          product_id: string | null
          read: boolean | null
          title: string
          type: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          product_id?: string | null
          read?: boolean | null
          title: string
          type: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          product_id?: string | null
          read?: boolean | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_targets: {
        Row: {
          created_at: string | null
          follow_up_draft: string | null
          follower_count: number | null
          handle_or_email: string | null
          id: string
          name: string
          outreach_draft: string | null
          persona: string | null
          personalization_notes: string | null
          platform: string | null
          product_id: string
          relevance_score: number | null
          status: string | null
          tier: string | null
          type: string
          why_good_fit: string | null
        }
        Insert: {
          created_at?: string | null
          follow_up_draft?: string | null
          follower_count?: number | null
          handle_or_email?: string | null
          id?: string
          name: string
          outreach_draft?: string | null
          persona?: string | null
          personalization_notes?: string | null
          platform?: string | null
          product_id: string
          relevance_score?: number | null
          status?: string | null
          tier?: string | null
          type: string
          why_good_fit?: string | null
        }
        Update: {
          created_at?: string | null
          follow_up_draft?: string | null
          follower_count?: number | null
          handle_or_email?: string | null
          id?: string
          name?: string
          outreach_draft?: string | null
          persona?: string | null
          personalization_notes?: string | null
          platform?: string | null
          product_id?: string
          relevance_score?: number | null
          status?: string | null
          tier?: string | null
          type?: string
          why_good_fit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          already_tried: string | null
          brand_voice: string | null
          category: string | null
          competitors: string | null
          created_at: string | null
          description: string | null
          goals: string[] | null
          id: string
          logo_url: string | null
          monthly_budget: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          stage: string | null
          status: string | null
          target_audience: string | null
          target_geography: string | null
          url: string
        }
        Insert: {
          already_tried?: string | null
          brand_voice?: string | null
          category?: string | null
          competitors?: string | null
          created_at?: string | null
          description?: string | null
          goals?: string[] | null
          id?: string
          logo_url?: string | null
          monthly_budget?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          stage?: string | null
          status?: string | null
          target_audience?: string | null
          target_geography?: string | null
          url: string
        }
        Update: {
          already_tried?: string | null
          brand_voice?: string | null
          category?: string | null
          competitors?: string | null
          created_at?: string | null
          description?: string | null
          goals?: string[] | null
          id?: string
          logo_url?: string | null
          monthly_budget?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          stage?: string | null
          status?: string | null
          target_audience?: string | null
          target_geography?: string | null
          url?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_product_id: string | null
          agent_models: Json | null
          company: string | null
          created_at: string | null
          goals: string[] | null
          id: number
          name: string | null
          role: string | null
          sender_email: string | null
        }
        Insert: {
          active_product_id?: string | null
          agent_models?: Json | null
          company?: string | null
          created_at?: string | null
          goals?: string[] | null
          id?: number
          name?: string | null
          role?: string | null
          sender_email?: string | null
        }
        Update: {
          active_product_id?: string | null
          agent_models?: Json | null
          company?: string | null
          created_at?: string | null
          goals?: string[] | null
          id?: number
          name?: string | null
          role?: string | null
          sender_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_product_fk"
            columns: ["active_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_data: {
        Row: {
          content_url: string | null
          created_at: string | null
          current_rank: number | null
          difficulty: string | null
          id: string
          keyword: string
          product_id: string
          search_volume: string | null
          target_rank: number | null
        }
        Insert: {
          content_url?: string | null
          created_at?: string | null
          current_rank?: number | null
          difficulty?: string | null
          id?: string
          keyword: string
          product_id: string
          search_volume?: string | null
          target_rank?: number | null
        }
        Update: {
          content_url?: string | null
          created_at?: string | null
          current_rank?: number | null
          difficulty?: string | null
          id?: string
          keyword?: string
          product_id?: string
          search_volume?: string | null
          target_rank?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_data_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      social_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          platform: string
          platform_user_id: string | null
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          platform: string
          platform_user_id?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          platform?: string
          platform_user_id?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      strategies: {
        Row: {
          brand_voice_doc: string | null
          channel_priorities_json: Json | null
          created_at: string | null
          icp_json: Json | null
          id: string
          messaging_hierarchy: Json | null
          ninety_day_plan_json: Json | null
          positioning: string | null
          product_id: string
          version: number | null
        }
        Insert: {
          brand_voice_doc?: string | null
          channel_priorities_json?: Json | null
          created_at?: string | null
          icp_json?: Json | null
          id?: string
          messaging_hierarchy?: Json | null
          ninety_day_plan_json?: Json | null
          positioning?: string | null
          product_id: string
          version?: number | null
        }
        Update: {
          brand_voice_doc?: string | null
          channel_priorities_json?: Json | null
          created_at?: string | null
          icp_json?: Json | null
          id?: string
          messaging_hierarchy?: Json | null
          ninety_day_plan_json?: Json | null
          positioning?: string | null
          product_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

