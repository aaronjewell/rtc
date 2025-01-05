import bcrypt from 'bcrypt';
import fs from 'fs/promises';
import mysql from 'mysql2/promise';

export class DAL {
    async init() {
        const dbPassword = await fs.readFile(process.env.DB_PASSWORD_FILE, 'utf8');
        this.pool = await mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: dbPassword,
            database: process.env.DB_DATABASE
        });

        await this.#seed();
    }

    async getUserByUsername(username) {
        const [users] = await this.pool.query(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );
        return users[0];
    }

    async updateLastLogin(username) {
        await this.pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?',
            [username]
        );
    }

    async #seed() {
        await this.pool.query('CREATE DATABASE IF NOT EXISTS chat_app');
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        `);

        if (process.env.NODE_ENV === 'development') {
            await this.#seedTestUser();
        }
    }

    async #seedTestUser() {
        const [existingUsers] = await this.pool.query(
            'SELECT * FROM users WHERE username = ?',
            ['testuser']
        );

        if (existingUsers.length === 0) {
            const hashedPassword = await bcrypt.hash(process.env.TEST_PASSWORD, 10);
            await this.pool.query(
                'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
                [process.env.TEST_USERNAME, hashedPassword, process.env.TEST_EMAIL]
            );
            console.log('Test user created successfully');
        }
    }

    async close() {
        await this.pool.end();
    }
}