import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ShopifyGraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string; locations: any[]; path: string[] }>;
  extensions?: { cost: { requestedQueryCost: number; throttleStatus: any } };
}

/**
 * Low-level Shopify GraphQL client with automatic rate-limit handling.
 * Wraps Admin API calls for a given shop + access token.
 */
@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private readonly apiVersion = '2024-04';

  constructor(private readonly config: ConfigService) {}

  /**
   * Build an axios client pre-configured for a specific store.
   */
  private buildClient(shopDomain: string, accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: `https://${shopDomain}/admin/api/${this.apiVersion}`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  /**
   * Execute a GraphQL query/mutation against the Shopify Admin API.
   * Automatically retries on throttle (429 / THROTTLED).
   */
  async graphql<T = any>(
    shopDomain: string,
    accessToken: string,
    query: string,
    variables: Record<string, any> = {},
    retries = 3,
  ): Promise<T> {
    const client = this.buildClient(shopDomain, accessToken);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { data } = await client.post<ShopifyGraphQLResponse<T>>(
          '/graphql.json',
          { query, variables },
        );

        if (data.errors?.length) {
          const throttled = data.errors.find((e) =>
            e.message.toLowerCase().includes('throttled'),
          );
          if (throttled && attempt < retries) {
            const delay = Math.pow(2, attempt) * 1000;
            this.logger.warn(`GraphQL throttled, retrying in ${delay}ms`);
            await this.sleep(delay);
            continue;
          }
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        return data.data;
      } catch (err) {
        if (err.response?.status === 429 && attempt < retries) {
          const retryAfter =
            parseInt(err.response.headers['retry-after'] || '2', 10) * 1000;
          this.logger.warn(`Rate limited, retrying in ${retryAfter}ms`);
          await this.sleep(retryAfter);
          continue;
        }
        throw err;
      }
    }

    throw new Error('Max retries exceeded for Shopify GraphQL request');
  }

  /**
   * Register a webhook on the shop.
   */
  async registerWebhook(
    shopDomain: string,
    accessToken: string,
    topic: string,
    address: string,
  ): Promise<string> {
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `;

    const result = await this.graphql<any>(shopDomain, accessToken, mutation, {
      topic: topic.toUpperCase().replace('/', '_'),
      webhookSubscription: {
        callbackUrl: address,
        format: 'JSON',
      },
    });

    if (result.webhookSubscriptionCreate.userErrors?.length) {
      throw new Error(
        `Webhook registration failed: ${JSON.stringify(result.webhookSubscriptionCreate.userErrors)}`,
      );
    }

    return result.webhookSubscriptionCreate.webhookSubscription.id;
  }

  /**
   * Fetch all locations for a store.
   */
  async getLocations(shopDomain: string, accessToken: string) {
    const query = `{
      locations(first: 50) {
        edges { node { id name } }
      }
    }`;
    const result = await this.graphql<any>(shopDomain, accessToken, query);
    return result.locations.edges.map((e: any) => e.node);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
