import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

export const readDatabase = (filePath, defaultValue = {}) => {
   try {
      const dirPath = path.dirname(filePath)

      if (!fs.existsSync(dirPath)) {
         fs.mkdirSync(dirPath, { recursive: true })
      }

      if (!fs.existsSync(filePath)) {
         console.warn(`File ${filePath} not found, initializing with default values.`)
         fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8')
         return defaultValue
      }

      const rawData = fs.readFileSync(filePath, 'utf8')
      const parsedData = JSON.parse(rawData)

      if (!parsedData || typeof parsedData !== 'object') {
         console.warn(`Invalid DB structure in ${filePath}:`, parsedData)
         return defaultValue
      }

      return parsedData
   } catch (error) {
      console.error(`Error reading ${filePath}`)
      return defaultValue
   }
}

export const writeDatabase = (filePath, data) => {
   try {
      const dirPath = path.dirname(filePath)

      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')

      return true
   } catch (error) {
      console.error(`Error writing to ${filePath}`)
      return false
   }
}


