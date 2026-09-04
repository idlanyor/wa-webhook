import ScheduledMessage from '../models/ScheduledMessage.js';
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
            const pendingMessages = await ScheduledMessage.find({
                status: 'pending',
                scheduledAt: { $lte: now }
            }).limit(50);

            if (pendingMessages.length === 0) {
                return;
            }

            info(`Processing ${pendingMessages.length} scheduled messages...`);

            for (const scheduled of pendingMessages) {
                try {
                    await this.sendScheduledMessage(scheduled);
                } catch (err) {
                    logError(`Failed to send scheduled message ${scheduled._id}:`, err);
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
            info(`Sending scheduled message ${scheduled._id} to ${scheduled.to}`);

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
            scheduled.status = 'sent';
            scheduled.sentAt = new Date();
            scheduled.messageId = result?.id || null;
            await scheduled.save();

            info(`Scheduled message ${scheduled._id} sent successfully`);
        } catch (err) {
            logError(`Error sending scheduled message ${scheduled._id}:`, err);

            // Update status to failed
            scheduled.status = 'failed';
            scheduled.error = err.message;
            await scheduled.save();

            throw err;
        }
    }

    /**
     * Create a new scheduled message
     */
    async createScheduledMessage(userId, data) {
        const scheduled = new ScheduledMessage({
            userId,
            to: data.to,
            message: data.message,
            messageType: data.messageType || 'text',
            interactiveData: data.interactiveData || null,
            scheduledAt: new Date(data.scheduledAt)
        });

        await scheduled.save();
        info(`Created scheduled message ${scheduled._id} for ${data.scheduledAt}`);

        return scheduled;
    }

    /**
     * Get user's scheduled messages
     */
    async getUserScheduledMessages(userId, filters = {}) {
        const query = { userId };

        if (filters.status) {
            query.status = filters.status;
        }

        return await ScheduledMessage.find(query)
            .sort({ scheduledAt: -1 })
            .limit(filters.limit || 100);
    }

    /**
     * Cancel a scheduled message
     */
    async cancelScheduledMessage(userId, messageId) {
        const scheduled = await ScheduledMessage.findOne({
            _id: messageId,
            userId,
            status: 'pending'
        });

        if (!scheduled) {
            throw new Error('Scheduled message not found or already processed');
        }

        scheduled.status = 'cancelled';
        await scheduled.save();

        info(`Cancelled scheduled message ${messageId}`);
        return scheduled;
    }

    /**
     * Delete a scheduled message
     */
    async deleteScheduledMessage(userId, messageId) {
        const scheduled = await ScheduledMessage.findOne({
            _id: messageId,
            userId
        });

        if (!scheduled) {
            throw new Error('Scheduled message not found');
        }

        await ScheduledMessage.deleteOne({ _id: messageId });
        info(`Deleted scheduled message ${messageId}`);

        return scheduled;
    }

    /**
     * Get statistics
     */
    async getStatistics(userId) {
        const [total, pending, sent, failed, cancelled] = await Promise.all([
            ScheduledMessage.countDocuments({ userId }),
            ScheduledMessage.countDocuments({ userId, status: 'pending' }),
            ScheduledMessage.countDocuments({ userId, status: 'sent' }),
            ScheduledMessage.countDocuments({ userId, status: 'failed' }),
            ScheduledMessage.countDocuments({ userId, status: 'cancelled' })
        ]);

        return {
            total,
            pending,
            sent,
            failed,
            cancelled
        };
    }
}

export default SchedulerService;
