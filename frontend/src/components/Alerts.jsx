import { Card, Offcanvas } from 'react-bootstrap'

const Alerts = ({ show, onClose, errors }) => {

   return (
      <Offcanvas className='offcanvas' show={show} onHide={onClose} placement='end'>
         <Offcanvas.Header className='display-6'>Alerts</Offcanvas.Header>
         <Offcanvas.Body>
            {errors && Object.keys(errors).length > 0 ? (
               Object.entries(errors).map(([source, errorList,]) =>
                  errorList.length > 0 ? (
                     <div key={source} className="mb-4">
                        {errorList.map((error, idx) => (
                           <Card key={idx} className="mb-3 border-danger">
                              <Card.Body>
                                 <Card.Title className="text-danger fw-semibold">
                                    {typeof error.error === 'object' ? 'An error occurred' : error.error || 'Unknown error'}
                                 </Card.Title>
                                 <Card.Text className="text-muted">
                                    <small>{new Date(error.timestamp).toLocaleString()}</small>
                                 </Card.Text>
                              </Card.Body>
                           </Card>
                        ))}
                     </div>
                  ) : null
               )
            ) : (
               <p className="text-muted">No alerts at the moment.</p>
            )}
         </Offcanvas.Body>
      </Offcanvas>
   )
}

export default Alerts