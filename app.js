import express, { static as expressStatic, json, urlencoded } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import configuration
import { config, validateConfig } from './src/config/index.js';
import { initializeDatabase } from './src/config/database.js';

// Runtime detection
const runtime = {
  isBun: typeof Bun !== 'undefined',
  isNode: typeof process !== 'undefined' && process.versions && process.versions.node,
  name: typeof Bun !== 'undefined' ? 'bun' : 'node'
};

// Import services
import WhatsAppService from './src/services/WhatsAppService.js';
import WebhookService from './src/services/WebhookService.js';
import CampaignService from './src/services/CampaignService.js';
import { getMany } from './src/services/SettingsService.js';

// Import routes
import authRoutes from './src/routes/auth.js';
import appRoutes from './src/routes/app.js';
import whatsappRoutes from './src/routes/whatsapp.js';
import contactRoutes from './src/routes/contacts.js';
import autoReplyRoutes from './src/routes/autoReply.js';
import apiKeyRoutes from './src/routes/apiKeys.js';
import chatRoutes from './src/routes/chat.js';
import templateRoutes from './src/routes/templates.js';
import campaignRoutes from './src/routes/campaigns.js'; 
import settingsRoutes from './src/routes/settings.js';

// Import utilities
import { info, error as _error, warn } from './src/utils/logger.js';

class Application {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = null;
        this.whatsappService = null;
    }

    /**
     * Initialize the application
     */
    async initialize() {
        try {
            // Validate configuration
            validateConfig();
            info(`Configuration validated successfully - Runtime: ${runtime.name}`);

            // Initialize database
            initializeDatabase();
            info('Database initialized successfully');

            // Setup Express app
            this.setupExpress();
            
            // Setup Socket.IO
            this.setupSocketIO();
            
            // Setup WhatsApp service
            await this.setupWhatsAppService();
            
            // Setup routes
            this.setupRoutes();
            
            // Setup error handling
            this.setupErrorHandling();

            info('Application initialized successfully');
        } catch (error) {
            _error('Failed to initialize application', error);
            throw error;
        }
    }

    /**
     * Setup Express application
     */
    setupExpress() {
        // View engine setup
        this.app.set('view engine', 'ejs');
        this.app.set('views', join(__dirname, 'views'));

        // Middleware
        const puki = expressStatic(join(__dirname, 'public'));
        this.app.use(puki);
        this.app.use(cors());
        
        // Custom JSON parser with better error handling
        this.app.use(json({
            verify: (req, res, buf, encoding) => {
                try {
                    // Store raw body for potential fixing
                    req.rawBody = buf.toString(encoding);
                } catch (err) {
                    // Continue with default behavior
                }
            }
        }));
        
        this.app.use(urlencoded({ extended: true }));
        this.app.use(cookieParser());

        // Request logging middleware
        this.app.use((req, res, next) => {
            info(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                runtime: runtime.name
            });
            next();
        });

        info('Express application configured');
    }

    /**
     * Setup Socket.IO
     */
    setupSocketIO() {
        this.io = new Server(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        // Socket connection handling
        this.io.on('connection', (socket) => {
            const userId = socket.handshake.query.userId;
            if (userId) {
                socket.join(userId);
                info(`Socket connected for user: ${userId}`);
            }

            socket.on('disconnect', () => {
                info(`Socket disconnected for user: ${userId}`);
            });
        });

        // Make io available to routes
        this.app.set('io', this.io);

        info('Socket.IO configured');
    }

    /**
     * Setup WhatsApp service
     */
    async setupWhatsAppService() {
        this.whatsappService = new WhatsAppService(this.io);
        
        // Load settings from database
        await this.whatsappService.loadSettings();
        
        // Make whatsapp service available to routes
        this.app.set('whatsappService', this.whatsappService);

        // Setup Webhook service with dynamic settings
        const getWebhookSettings = async () => {
            const map = await getMany(['webhook_url', 'webhook_secret']);
            return { url: map.get('webhook_url') || null, secret: map.get('webhook_secret') || null };
        };
        this.webhookService = new WebhookService(getWebhookSettings);
        this.app.set('webhookService', this.webhookService);
        // Attach webhooks to WhatsAppService
        this.whatsappService.setWebhookService(this.webhookService);

        info('WhatsApp service configured');

        // Simple scheduler for campaigns
        setInterval(async () => {
            try {
                const due = await CampaignService.dueCampaigns(new Date());
                for (const c of due) {
                    // Avoid double run: set running immediately
                    await CampaignService.updateStatus(c.id, 'running');
                    CampaignService.processCampaign(this.app, c).catch(()=>{});
                }
            } catch (e) {
                _error('Scheduler error', e);
            }
        }, 15000);
    }

    /**
     * Setup application routes
     */
    setupRoutes() {
        // Authentication routes
        this.app.use('/', authRoutes);
        
        // Main application routes
        this.app.use('/', appRoutes);
        
        // WhatsApp API routes
        this.app.use('/', whatsappRoutes);
        
        // Contact management routes
        this.app.use('/contacts', contactRoutes);
        
        // Auto-reply routes
        this.app.use('/auto-reply', autoReplyRoutes);
        
        // API key management routes
        this.app.use('/api-keys', apiKeyRoutes);
        
        // Chat API routes
        this.app.use('/api/chats', chatRoutes);

        // Message templates routes
        this.app.use('/templates', templateRoutes);

        // Campaigns routes
        this.app.use('/campaigns', campaignRoutes);

        // Settings routes
        this.app.use('/settings', settingsRoutes);

        info('Routes configured');
    }

    /**
     * Setup error handling
     */
    setupErrorHandling() {
        // 404 handler
        this.app.use((req, res) => {
            warn(`404 - Page not found: ${req.path}`);
            res.status(404).render('error', { 
                error: 'Page not found',
                message: 'The page you are looking for does not exist.'
            });
        });

        // Global error handler
        this.app.use((err, req, res, next) => {
            _error('Unhandled error', err);
            
            // Handle JSON parsing errors specifically
            if (err.type === 'entity.parse.failed' && err.body && req.rawBody) {
                warn('JSON parse error detected, attempting to fix backticks in message');
                
                try {
                    // Fix backticks in the raw body
                    const fixedBody = req.rawBody.replace(/`([^`]*)`/g, '"$1"');
                    const parsedBody = JSON.parse(fixedBody);
                    
                    // Store the fixed body for the route to use
                    req.body = parsedBody;
                    
                    // Log the fix
                    info('Successfully fixed JSON with backticks', {
                        original: req.rawBody.substring(0, 200) + '...',
                        fixed: fixedBody.substring(0, 200) + '...'
                    });
                    
                    // Continue to the route handler
                    return next();
                } catch (fixError) {
                    _error('Failed to fix JSON parsing error', fixError);
                }
            }
            
            const statusCode = err.statusCode || 500;
            const message = config.node_env === 'production' 
                ? 'Something went wrong' 
                : err.message;

            // Return JSON error for API endpoints
            if (req.path.startsWith('/api/') || req.path.includes('/send-message') || req.path.includes('/send-bulk')) {
                return res.status(statusCode).json({
                    error: 'request_error',
                    message: err.type === 'entity.parse.failed' 
                        ? 'Invalid JSON format. Please check for unescaped backticks or quotes in your message.'
                        : message,
                    details: config.node_env !== 'production' ? err.stack : undefined
                });
            }

            res.status(statusCode).render('error', {
                error: 'Internal Server Error',
                message: message
            });
        });

        info('Error handling configured');
    }

    /**
     * Start the server
     */
    async start() {
        try {
            await this.initialize();

            // Preload WhatsApp sessions for existing users
            if (!process.env.JEST_WORKER_ID) {
                await this.whatsappService.preloadSessions();
            }

            // Start server
            this.server.listen(config.port, '0.0.0.0', () => {
                info(`WhatsApp service running on port ${config.port}`);
                info(`Server started successfully on ${runtime.name} runtime`, { 
                    port: config.port,
                    runtime: runtime.name,
                    optimizations: runtime.isBun ? 'enabled' : 'disabled'
                });
                console.log(`🚀 Server running on http://localhost:${config.port} (${runtime.name})`);
                if (runtime.isBun) {
                    console.log('⚡ Bun optimizations active');
                }
            });

        } catch (error) {
            _error('Failed to start server', error);
            process.exit(1);
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        info('Shutting down server...');
        
        // Close all WhatsApp sessions
        if (this.whatsappService) {
            // Implementation for closing all sessions would go here
        }

        // Close server
        this.server.close(() => {
            info('Server shut down successfully');
            process.exit(0);
        });
    }
}

// For testing environment
if (process.env.JEST_WORKER_ID) {
    const mockApp = express();
    const mockServer = createServer(mockApp);
    
    // Export mock objects for testing
    module.exports = { 
        app: mockApp, 
        server: mockServer, 
        ensureSession: async () => ({
            isConnected: true,
            state: 'connected',
            qr: null,
            sock: {
                sendMessage: async () => ({ key: { id: 'test-id' }, message: {} }),
                user: { id: 'bot@s.whatsapp.net' }
            }
        })
    };
} else {
    // Production/Development startup
    const app = new Application();
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => app.shutdown());
    process.on('SIGINT', () => app.shutdown());
    
    // Start the application
    app.start().catch(error => {
        console.error('Failed to start application:', error);
        process.exit(1);
    });
}
