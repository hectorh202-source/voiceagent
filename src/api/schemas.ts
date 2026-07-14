import { z } from "zod";

export const patchCallsSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1),
  isRead: z.boolean().optional(),
  recoveryStatus: z.enum(["recovered", "not_recovered"]).nullable().optional(),
  statusOverride: z.enum(["booked", "not_booked", "excused"]).nullable().optional(),
});

export const businessInfoSchema = z.object({
  name: z.string().min(1).optional(),
  serviceTitanBusinessUnitId: z.string().optional(),
  serviceTitanCampaignId: z.string().optional(),
  serviceTitanJobTypeId: z.string().optional(),
  serviceCategories: z
    .array(
      z.object({
        name: z.string(),
        businessUnitId: z.string(),
        jobTypeId: z.string(),
      }),
    )
    .optional(),
});

export const generalSettingsSchema = z.object({
  elevenLabsApiKey: z.string().optional(),
  elevenLabsAgentId: z.string().optional(),
  serviceTitanEnvironment: z.enum(["integration", "production"]).optional(),
  serviceTitanClientId: z.string().optional(),
  serviceTitanClientSecret: z.string().optional(),
  serviceTitanAppKey: z.string().optional(),
  serviceTitanTenantId: z.string().optional(),
  serviceTitanCallReasonId: z.string().optional(),
  serviceTitanTagName: z.string().optional(),
  serviceTitanBookingMode: z.enum(["lead", "job"]).optional(),
  timezone: z.string().optional(),
  dashboardBaseUrl: z.string().optional(),
  toolWebhookSecret: z.string().optional(),
  postCallWebhookSecret: z.string().optional(),
});
