import { and, eq, desc, lte, count } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { scheduledMessages } = schema;
import { info, error as logError, warn } from '../utils/logger.js';

class SchedulerService {
    constructor(whatsappService) {
        this.whatsappService = whatsappService;
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Start the scheduler
     */
    start() {
        if (this.isRunning) {
            warn('Scheduler is already running');
            return;
        }

        info('Starting message scheduler...');
        this.isRunning = true;

        // Check every 30 seconds for pending messages
        this.intervalId = setInterval(() => {
            this.processPendingMessages().catch(err => {
                logError('Error processing pending messages:', err);
            });
        }, 30000);

        // Process immediately on start
        this.processPendingMessages().catch(err => {
            logError('Error processing pending messages on start:', err);
        });

        info('Message scheduler started');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        info('Stopping message scheduler...');
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        info('Message scheduler stopped');
    }

    /**
     * Process pending scheduled messages
     */
    async processPendingMessages() {
        try {
            const now = new Date();

            // Find all pending messages that should be sent
            const pendingMessages = db.select().from(scheduledMessages)
                .where(and(eq(scheduledMessages.status, 'pending'), lte(scheduledMessages.scheduledAt, now)))
                .orderBy(scheduledMessages.scheduledAt)
                .limit(50)
                .all();

            if (pendingMessages.length === 0) {
                return;
            }

            info(`Processing ${pendingMessages.length} scheduled messages...`);

            for (const scheduled of pendingMessages) {
                try {
                    await this.sendScheduledMessage(scheduled);
                } catch (err) {
                    logError(`Failed to send scheduled message ${scheduled.id}:`, err);
                }
            }
        } catch (err) {
            logError('Error in processPendingMessages:', err);
        }
    }

    /**
     * Send a scheduled message
     */
    async sendScheduledMessage(scheduled) {
        try {
            info(`Sending scheduled message ${scheduled.id} to ${scheduled.to}`);

            let result;

            if (scheduled.messageType === 'text') {
                // Send text message
                result = await this.whatsappService.sendMessage(
                    scheduled.userId.toString(),
                    scheduled.to,
                    scheduled.message
                );
            } else if (scheduled.messageType === 'interactive' && scheduled.interactiveData) {
                // Send interactive message
                result = await this.whatsappService.sendInteractiveMessage(
                    scheduled.userId.toString(),
                    scheduled.to,
                    scheduled.interactiveData
                );
            } else {
                throw new Error('Invalid message type or missing interactive data');
            }

            // Update status to sent
            SchedulerService._update(scheduled.id, {
                status: 'sent',
                sentAt: new Date(),
                messageId: result?.id || null
            });

            info(`Scheduled message ${scheduled.id} sent successfully`);
        } catch (err) {
            logError(`Error sending scheduled message ${scheduled.id}:`, err);

            // Update status to failed
            SchedulerService._update(scheduled.id, { status: 'failed', error: err.message });

            throw err;
        }
    }

    static _update(id, values) {
        db.update(scheduledMessages).set(values).where(eq(scheduledMessages.id, String(id))).run();
    }

    /**
     * Create a new scheduled message
     */
    async createScheduledMessage(userId, data) {
        const [scheduled] = db.insert(scheduledMessages).values({
            userId: String(userId),
            to: data.to,
            message: data.message,
            messageType: data.messageType || 'text',
            interactiveData: data.interactiveData || null,
            scheduledAt: new Date(data.scheduledAt)
        }).returning().all();
        info(`Created scheduled message ${scheduled.id} for ${data.scheduledAt}`);

        return scheduled;
    }

    /**
     * Get user's scheduled messages
     */
    async getUserScheduledMessages(userId, filters = {}) {
        const conditions = [eq(scheduledMessages.userId, String(userId))];
        if (filters.status) {
            conditions.push(eq(scheduledMessages.status, filters.status));
        }

        return db.select().from(scheduledMessages)
            .where(and(...conditions))
            .orderBy(desc(scheduledMessages.scheduledAt))
            .limit(filters.limit || 100)
            .all();
    }

    /**
     * Cancel a scheduled message
     */
    async cancelScheduledMessage(userId, messageId) {
        const [scheduled] = db.update(scheduledMessages)
            .set({ status: 'cancelled' })
            .where(and(
                eq(scheduledMessages.id, String(messageId)),
                eq(scheduledMessages.userId, String(userId)),
                eq(scheduledMessages.status, 'pending')
            ))
            .returning()
            .all();

        if (!scheduled) {
            throw new Error('Scheduled message not found or already processed');
        }

        info(`Cancelled scheduled message ${messageId}`);
        return scheduled;
    }

    /**
     * Delete a scheduled message
     */
    async deleteScheduledMessage(userId, messageId) {
        const [scheduled] = db.delete(scheduledMessages)
            .where(and(eq(scheduledMessages.id, String(messageId)), eq(scheduledMessages.userId, String(userId))))
            .returning()
            .all();

        if (!scheduled) {
            throw new Error('Scheduled message not found');
        }
        info(`Deleted scheduled message ${messageId}`);

        return scheduled;
    }

    /**
     * Get statistics
     */
    async getStatistics(userId) {
        const rows = db.select({ status: scheduledMessages.status, n: count() })
            .from(scheduledMessages)
            .where(eq(scheduledMessages.userId, String(userId)))
            .groupBy(scheduledMessages.status)
            .all();

        const stats = { total: 0, pending: 0, sent: 0, failed: 0, cancelled: 0 };
        for (const { status, n } of rows) {
            stats[status] = n;
            stats.total += n;
        }
        return stats;
    }
}

export default SchedulerService;
