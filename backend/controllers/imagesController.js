import fs from 'fs'
import path from 'path'
import axios from 'axios'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMAGE_CACHE_DIR = path.join(__dirname, '../assets/gfa/images')

let facilityInstance = null

const imagesController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   getPlayerImage: async (req, res) => {
      const { player_id } = req.params
      const localImagePath = path.join(IMAGE_CACHE_DIR, `${player_id}.jpg`)

      // check if image is cached
      if (fs.existsSync(localImagePath)) return res.sendFile(localImagePath)

      try {
         // Fetch image from CSA if not in cache
         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/images/players/${player_id}.jpg`, {
            responseType: 'arraybuffer',
            validateStatus: (status) => status === 200 || status === 404
         })

         if (csaResponse.status === 200) {
            // Ensure cache directory exist
            if (!fs.existsSync(IMAGE_CACHE_DIR)) fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true })

            fs.writeFileSync(localImagePath, csaResponse.data)

            return res.sendFile(localImagePath)
         }
      } catch (error) {
         res.status(500).json({ message: 'Server error', error: error})
      }
      return res.status(404).json({ error: 'Player image not found.'})
   }
}

export default imagesController