let facilityInstance = null

const reportErrorToCentralController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   reportError: (req, res) => {
      try {
         const { error, stack, source } = req.body

         if (!error || !stack) return res.status(400).json({ message: 'Missing required error details (message, stack)'})

         const errorSource = source || 'facility'

         facilityInstance.reportErrorToCentral.report({
            error: error,
            stack: stack || null
         }, errorSource)

         res.status(200).json({ message: 'Error reported successfully.' })

      } catch (error) {
         console.error('Having problem reporting the error', error)
         res.status(500).json({ message: 'Having problem reporting the error', error: error})
      }
   },
}

export default reportErrorToCentralController