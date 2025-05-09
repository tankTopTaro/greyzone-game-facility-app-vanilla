import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

export default class DBManager {
    constructor(basePath) {
        this.basePath = basePath
        this.databases = {}
        this.dirtyFlags = {}
        this.locks = {}
    }

    _getFullPath(name) {
        return path.join(this.basePath, `${name}.json`)
    }

    loadDatabase(name) {
        const fullPath = this._getFullPath(name)

        if (!fs.existsSync(path.dirname(fullPath))) {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        }

        if (!fs.existsSync(fullPath)) {
            console.warn(`File ${fullPath} not found, initializing with empty object.`)
            this.databases[name] = {}
            this.saveDatabase(name)
        } else {
            try {
                const rawData = fs.readFileSync(fullPath, 'utf-8')
                this.databases[name] = JSON.parse(rawData) || {}
            } catch (error) {
                console.error(`Error loading ${name}:`, error)
                this.databases[name] = {}
            }
        }
    }

    async saveDatabase(name) {
        if (this.locks[name]) {
            await this.locks[name]
            return
        }

        let resolveLock
        this.locks[name] = new Promise(resolve => resolveLock = resolve)

        try {
            const fullPath = this._getFullPath(name)
            if (!fs.existsSync(path.dirname(fullPath))) {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true })
            }

            fs.writeFileSync(fullPath, JSON.stringify(this.databases[name], null, 2), 'utf-8')
            this.dirtyFlags[name] = false
            // console.log(`Saved ${name}.json`)
        } catch (error) {
            console.error(`Error saving ${name}:`, error)
        } finally {
            resolveLock()
            this.locks[name] = null
        }
    }

    get(name) {
        if (!this.databases[name]) {
            this.loadDatabase(name)
        }
        return this.databases[name]
    }

    markDirty(name) {
        this.dirtyFlags[name] = true
    }

    async maybeSave(name) {
        if (this.dirtyFlags[name]) {
            this.saveDatabase(name)
        }
    }

    async saveAll() {
        for (const name of Object.keys(this.databases)) {
            await this.maybeSave(name)
        }
    }
}