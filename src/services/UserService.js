import bcrypt from 'bcryptjs';
import { eq, desc, count, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { users } = schema;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
}

/** Strip the password hash from a user row. */
function toPublic(user) {
    if (!user) return null;
    const { password, ...rest } = user;
    return rest;
}

class UserService {
    static findById(id) {
        if (!id) return null;
        return db.select().from(users).where(eq(users.id, String(id))).get() ?? null;
    }

    static findPublicById(id) {
        return toPublic(UserService.findById(id));
    }

    static findByEmail(email) {
        return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get() ?? null;
    }

    static list() {
        return db.select().from(users).orderBy(desc(users.createdAt)).all().map(toPublic);
    }

    static count() {
        return db.select({ n: count() }).from(users).get().n;
    }

    static async create({ name, email, password, role = 'user' }) {
        const [user] = db.insert(users).values({
            name,
            email: normalizeEmail(email),
            password: await hashPassword(password),
            role
        }).returning().all();
        return toPublic(user);
    }

    /** Update profile fields; `password` is re-hashed when non-empty. */
    static async update(id, { name, email, role, password }) {
        const values = {};
        if (name !== undefined) values.name = name;
        if (email !== undefined) values.email = normalizeEmail(email);
        if (role !== undefined) values.role = role;
        if (password && password.trim() !== '') values.password = await hashPassword(password);
        if (Object.keys(values).length === 0) return UserService.findPublicById(id);
        const [user] = db.update(users).set(values).where(eq(users.id, String(id))).returning().all();
        return toPublic(user);
    }

    static delete(id) {
        return db.delete(users).where(eq(users.id, String(id))).run();
    }

    static comparePassword(user, candidatePassword) {
        return bcrypt.compare(candidatePassword, user.password);
    }

    /** Mark (or clear with null) the paired WhatsApp session for preload on boot. */
    static setWaSession(id, sessionId) {
        return db.update(users).set({ waSessionId: sessionId }).where(eq(users.id, String(id))).run();
    }

    static listLinkedSessionIds() {
        return db.select({ waSessionId: users.waSessionId })
            .from(users)
            .where(isNotNull(users.waSessionId))
            .all()
            .map(r => r.waSessionId);
    }
}

export default UserService;
