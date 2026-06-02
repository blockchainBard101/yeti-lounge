import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { PrismaService } from './prisma.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private graphqlClient: SuiGraphQLClient;
  private intervalId: NodeJS.Timeout | null = null;
  private packageId: string;
  private readonly processedEvents = new Set<string>();

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {
    this.graphqlClient = new SuiGraphQLClient({
      network: 'testnet',
      url: 'https://graphql.testnet.sui.io/graphql',
    });
    this.packageId = this.configService.get<string>('PACKAGE_ID') || '0xee0b17b8c784f3a00fe40029e4f2992bc971acde22cf83f8799d1b9731811232';
  }

  async onModuleInit() {
    this.logger.log('Starting Yeti Lounge event indexer...');
    
    // Start interval-based indexing every 10 seconds
    this.intervalId = setInterval(() => {
      this.indexEvents().catch((err) => {
        this.logger.error('Failed to run index events loop:', err);
      });
    }, 10000);
  }

  async onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private async indexEvents() {
    if (!this.packageId || this.packageId === '0x_placeholder_package_id') {
      // Mock indexing logs in terminal since no Move package is deployed yet
      this.logger.debug('Waiting for a deployed Move package ID to begin on-chain indexing.');
      return;
    }

    try {
      this.logger.log(`Querying events for package: ${this.packageId}`);
      
      const modules = ['profile', 'post', 'event', 'rewards'];
      
      for (const module of modules) {
        const response = await this.graphqlClient.query({
          query: `
            query GetEvents($filter: EventFilter!) {
              events(filter: $filter, first: 20) {
                nodes {
                  timestamp
                  eventBcs
                  contents {
                    type {
                      repr
                    }
                    json
                  }
                }
              }
            }
          `,
          variables: {
            filter: {
              type: `${this.packageId}::${module}`,
            },
          },
        });

        if (response.errors && response.errors.length > 0) {
          this.logger.error(`GraphQL errors for module ${module}:`, response.errors);
          continue;
        }

        const nodes = (response.data as any)?.events?.nodes || [];

        for (const node of nodes) {
          if (node.eventBcs && this.processedEvents.has(node.eventBcs)) {
            continue;
          }

          const type = node.contents?.type?.repr;
          if (!type) continue;

          const parsedJson = node.contents?.json as any;
          if (!parsedJson) continue;

          // Profile Events
          if (type.endsWith('::ProfileCreated')) {
            const { owner, suins_handle, avatar_blob_id, bio } = parsedJson;
            await this.prismaService.user.upsert({
              where: { suiAddress: owner },
              update: { suinsHandle: suins_handle, avatarBlobId: avatar_blob_id, bio },
              create: { suiAddress: owner, suinsHandle: suins_handle, avatarBlobId: avatar_blob_id, bio },
            });
            this.logger.log(`Indexed ProfileCreated for user: ${owner}`);
          }
          else if (type.endsWith('::AvatarUpdated')) {
            const { owner, new_blob_id } = parsedJson;
            await this.prismaService.user.update({
              where: { suiAddress: owner },
              data: { avatarBlobId: new_blob_id },
            });
            this.logger.log(`Indexed AvatarUpdated for user: ${owner}`);
          }
          else if (type.endsWith('::ProfileUpdated')) {
            const { owner, new_avatar_blob_id, new_bio } = parsedJson;
            await this.prismaService.user.update({
              where: { suiAddress: owner },
              data: { avatarBlobId: new_avatar_blob_id, bio: new_bio },
            });
            this.logger.log(`Indexed ProfileUpdated for user: ${owner}`);
          }
          else if (type.endsWith('::HandleUpdated')) {
            const { owner, new_handle } = parsedJson;
            await this.prismaService.user.update({
              where: { suiAddress: owner },
              data: { suinsHandle: new_handle },
            });
            this.logger.log(`Indexed HandleUpdated for user: ${owner} to: ${new_handle}`);
          }

          // Post Events
          else if (type.endsWith('::PostCreated')) {
            const { post_id, author, text_content, media_blob_id } = parsedJson;
            // Ensure user exists first
            await this.prismaService.user.upsert({
              where: { suiAddress: author },
              update: {},
              create: { suiAddress: author }
            });
            await this.prismaService.post.upsert({
              where: { objectId: post_id },
              update: { textContent: text_content, mediaBlobId: media_blob_id },
              create: { objectId: post_id, authorAddress: author, textContent: text_content, mediaBlobId: media_blob_id },
            });
            this.logger.log(`Indexed PostCreated: ${post_id}`);
          }
          else if (type.endsWith('::PostYerrd')) {
            const { post_id, total_yerrs } = parsedJson;
            await this.prismaService.post.update({
              where: { objectId: post_id },
              data: { yerrsCount: Number(total_yerrs) },
            });
            this.logger.log(`Indexed PostYerrd: ${post_id}`);
          }
          else if (type.endsWith('::PostLiked')) {
            const { post_id, total_likes } = parsedJson;
            await this.prismaService.post.update({
              where: { objectId: post_id },
              data: { likes: Number(total_likes) },
            });
            this.logger.log(`Indexed PostLiked: ${post_id}`);
          }
          else if (type.endsWith('::PostUpvoted')) {
            const { post_id, total_upvotes } = parsedJson;
            await this.prismaService.post.update({
              where: { objectId: post_id },
              data: { upvotes: Number(total_upvotes) },
            });
            this.logger.log(`Indexed PostUpvoted: ${post_id}`);
          }
          else if (type.endsWith('::PostDownvoted')) {
            const { post_id, total_downvotes } = parsedJson;
            await this.prismaService.post.update({
              where: { objectId: post_id },
              data: { downvotes: Number(total_downvotes) },
            });
            this.logger.log(`Indexed PostDownvoted: ${post_id}`);
          }
          else if (type.endsWith('::CommentAdded')) {
            const { post_id, author, text_content, created_at } = parsedJson;
            // Ensure user exists
            await this.prismaService.user.upsert({
              where: { suiAddress: author },
              update: {},
              create: { suiAddress: author }
            });
            await this.prismaService.comment.create({
              data: {
                postId: post_id,
                authorAddress: author,
                textContent: text_content,
                createdAt: new Date(Number(created_at))
              }
            });
            this.logger.log(`Indexed CommentAdded on post: ${post_id}`);
          }

          // Event/RSVP Events
          else if (type.endsWith('::EventCreated')) {
            const { event_id, title } = parsedJson;
            
            // Fetch live details from the on-chain YetiEvent shared object
            const details = await this.fetchEventDetails(event_id);

            await this.prismaService.event.upsert({
              where: { objectId: event_id },
              update: { 
                title, 
                description: details.description, 
                eventDate: new Date(details.start_time) 
              },
              create: { 
                objectId: event_id, 
                title, 
                description: details.description, 
                eventDate: new Date(details.start_time) 
              },
            });
            this.logger.log(`Indexed EventCreated: ${event_id}`);
          }
          else if (type.endsWith('::UserRSVPd')) {
            const { event_id, attendee, ticket_id } = parsedJson;
            // Ensure user exists
            await this.prismaService.user.upsert({
              where: { suiAddress: attendee },
              update: {},
              create: { suiAddress: attendee }
            });
            await this.prismaService.rsvp.create({
              data: {
                eventId: event_id,
                suiAddress: attendee,
                ticketId: ticket_id,
              }
            });
            this.logger.log(`Indexed UserRSVPd for event: ${event_id}`);
          }

          // Rewards/Quest Events
          else if (type.endsWith('::QuestAdded')) {
            const { quest_id, title, description, reward } = parsedJson;
            await this.prismaService.quest.upsert({
              where: { objectId: quest_id },
              update: { title, description, reward: Number(reward) },
              create: { objectId: quest_id, title, description, reward: Number(reward) },
            });
            this.logger.log(`Indexed QuestAdded: ${quest_id}`);
          }
          else if (type.endsWith('::QuestCompleted')) {
            const { quest_id, user } = parsedJson;
            // Ensure user exists
            await this.prismaService.user.upsert({
              where: { suiAddress: user },
              update: {},
              create: { suiAddress: user }
            });
            await this.prismaService.questCompletion.create({
              data: {
                questId: quest_id,
                suiAddress: user,
              }
            });
            this.logger.log(`Indexed QuestCompleted for user: ${user}`);
          }

          if (node.eventBcs) {
            this.processedEvents.add(node.eventBcs);
          }
        }
      }
    } catch (err) {
      this.logger.error('Error fetching Sui events:', err);
    }
  }

  // Helper method to set package ID once contracts are deployed
  setPackageId(newPackageId: string) {
    this.packageId = newPackageId;
    this.logger.log(`Indexer package target updated to: ${newPackageId}`);
  }

  // Fetch event details directly from the shared YetiEvent object
  private async fetchEventDetails(eventId: string): Promise<{ description: string; start_time: number }> {
    try {
      const response = await this.graphqlClient.query({
        query: `
          query GetEventObject($id: SuiAddress!) {
            object(address: $id) {
              asMoveObject {
                contents {
                  json
                }
              }
            }
          }
        `,
        variables: {
          id: eventId,
        },
      });

      const json = (response.data as any)?.object?.asMoveObject?.contents?.json;
      if (json) {
        return {
          description: json.description || '',
          start_time: Number(json.start_time || Date.now()),
        };
      }
    } catch (err) {
      this.logger.error(`Failed to fetch on-chain event details for ${eventId}:`, err);
    }
    return { description: '', start_time: Date.now() };
  }
}
