import Container from 'react-bootstrap/Container'
import Navbar from 'react-bootstrap/Navbar'
import Button from 'react-bootstrap/Button'
import { Badge } from 'react-bootstrap'
import { useState } from 'react'
 
const Navigation = ({ setShowAlerts, errorCount }) => {
   const [isDarkMode, setIsDarkMode] = useState(false)

   const handleShowAlerts = () => {
      setShowAlerts(true)
   }

   const toggleTheme = () => {
      document.body.classList.toggle('dark-mode')
      setIsDarkMode(prev => !prev)
   }

   const sunIcon = (
      <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icon-tabler-sun">
         <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
         <path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
         <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />
      </svg>
   );

   const moonIcon = (
      <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icon-tabler-moon">
         <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
         <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
      </svg>
   );

   return (
      <Navbar expand="lg">
         <Container>
            <Navbar.Brand>Greyzone Facility</Navbar.Brand>
            <div className='d-flex align-items-center gap-2'>
               {/* Theme Toggle Button */}
               <Button 
                  variant="secondary" 
                  onClick={toggleTheme} 
                  className="d-flex align-items-center p-2"
                  aria-label="Toggle dark mode"
               >
                  {isDarkMode ? sunIcon : moonIcon}
               </Button>

               {/* Alert Button */}
               <Button 
                  variant="secondary"  
                  onClick={handleShowAlerts}
                  className="position-relative" 
               >
                  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icons-tabler-outline icon-tabler-alert-circle">
                     <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                     <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
                     <path d="M12 8v4" />
                     <path d="M12 16h.01" />
                  </svg>
                  {errorCount > 0 && (
                     <Badge pill bg="danger" className="position-absolute top-0 start-100 translate-middle">
                        {errorCount}
                     </Badge>
                  )}
               </Button>
            </div>
         </Container>
      </Navbar>
   )
}

export default Navigation