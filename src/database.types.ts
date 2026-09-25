export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  graphql_public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
  public: {
    Tables: {
      companies: {
        Row: {
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["company_kind"];
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["company_kind"];
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["company_kind"];
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      erp_document_upload_chunks: {
        Row: {
          content_hash: string;
          created_at: string;
          embedding: string;
          error_text: string;
          file_name: string;
          seq: number;
          steps: string;
          upload_id: string;
          uploaded_by: string;
        };
        Insert: {
          content_hash: string;
          created_at?: string;
          embedding: string;
          error_text: string;
          file_name: string;
          seq: number;
          steps: string;
          upload_id: string;
          uploaded_by: string;
        };
        Update: {
          content_hash?: string;
          created_at?: string;
          embedding?: string;
          error_text?: string;
          file_name?: string;
          seq?: number;
          steps?: string;
          upload_id?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "erp_document_upload_chunks_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      erp_documents: {
        Row: {
          chunk_count: number;
          content_hash: string;
          created_at: string;
          file_name: string;
          id: string;
          ingested_at: string;
          ingested_by: string | null;
          page_count: number;
          updated_at: string;
        };
        Insert: {
          chunk_count: number;
          content_hash: string;
          created_at?: string;
          file_name: string;
          id?: string;
          ingested_at?: string;
          ingested_by?: string | null;
          page_count: number;
          updated_at?: string;
        };
        Update: {
          chunk_count?: number;
          content_hash?: string;
          created_at?: string;
          file_name?: string;
          id?: string;
          ingested_at?: string;
          ingested_by?: string | null;
          page_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "erp_documents_ingested_by_fkey";
            columns: ["ingested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_base_entries: {
        Row: {
          cause: string | null;
          created_at: string;
          embedding: string | null;
          erp_document_id: string | null;
          error_text: string;
          id: string;
          source: Database["public"]["Enums"]["kb_source"];
          source_company_id: string | null;
          source_ticket_id: string | null;
          steps: string | null;
          updated_at: string;
        };
        Insert: {
          cause?: string | null;
          created_at?: string;
          embedding?: string | null;
          erp_document_id?: string | null;
          error_text: string;
          id?: string;
          source: Database["public"]["Enums"]["kb_source"];
          source_company_id?: string | null;
          source_ticket_id?: string | null;
          steps?: string | null;
          updated_at?: string;
        };
        Update: {
          cause?: string | null;
          created_at?: string;
          embedding?: string | null;
          erp_document_id?: string | null;
          error_text?: string;
          id?: string;
          source?: Database["public"]["Enums"]["kb_source"];
          source_company_id?: string | null;
          source_ticket_id?: string | null;
          steps?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_base_entries_erp_document_id_fkey";
            columns: ["erp_document_id"];
            isOneToOne: false;
            referencedRelation: "erp_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_base_entries_source_company_id_fkey";
            columns: ["source_company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_base_entries_source_ticket_id_fkey";
            columns: ["source_ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          company_id: string;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          error_text: string;
          id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          updated_at: string;
          user_comment: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          error_text: string;
          id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          updated_at?: string;
          user_comment?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          error_text?: string;
          id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          updated_at?: string;
          user_comment?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      knowledge_base_public: {
        Row: {
          cause: string | null;
          error_text: string | null;
          id: string | null;
          source: Database["public"]["Enums"]["kb_source"] | null;
          steps: string | null;
        };
        Insert: {
          cause?: string | null;
          error_text?: string | null;
          id?: string | null;
          source?: Database["public"]["Enums"]["kb_source"] | null;
          steps?: string | null;
        };
        Update: {
          cause?: string | null;
          error_text?: string | null;
          id?: string | null;
          source?: Database["public"]["Enums"]["kb_source"] | null;
          steps?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_company_id: { Args: never; Returns: string };
      current_company_kind: {
        Args: never;
        Returns: Database["public"]["Enums"]["company_kind"];
      };
      is_service_staff: { Args: never; Returns: boolean };
      publish_erp_document: {
        Args: { p_page_count: number; p_upload_id: string };
        Returns: {
          chunk_count: number;
          document_id: string;
        }[];
      };
      remove_erp_document: { Args: { p_file_name: string }; Returns: boolean };
      stage_erp_document_chunks: {
        Args: {
          p_chunks: Json;
          p_content_hash: string;
          p_file_name: string;
          p_upload_id: string;
        };
        Returns: number;
      };
    };
    Enums: {
      company_kind: "client" | "internal" | "unassigned";
      kb_source: "ticket" | "erp_doc";
      ticket_status: "todo" | "resolved";
      user_role: "client_user" | "service_staff";
    };
    CompositeTypes: Record<never, never>;
  };
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      company_kind: ["client", "internal", "unassigned"],
      kb_source: ["ticket", "erp_doc"],
      ticket_status: ["todo", "resolved"],
      user_role: ["client_user", "service_staff"],
    },
  },
} as const;
