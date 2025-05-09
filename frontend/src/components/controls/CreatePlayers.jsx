/* eslint-disable no-unused-vars */
import { useState } from 'react'
import { Button, Col, Container, Dropdown, DropdownButton, Form, InputGroup, Row } from 'react-bootstrap'
import axios from 'axios'

const CreatePlayers = ({setShowToast, setToastMessage, setToastVariant}) => {
   const initialStates = {
      nick_name: "",
      email: "",
      phone_country_code: "+1",
      phone: "",
      last_name: "",
      first_name: "",
      gender: "",
      birth_date: "",
      league_country: "",
      league_city: "",
      league_district: "",
      league_other: "",
      notes: "",
      rfid_uid_tag: "",
      player_image: ""
   }
   const [formData, setFormData] = useState(initialStates)

  
   const handleChange = (e) => {
      setFormData({ ...formData, [e.target.name]: e.target.value })
   }

   const handleSubmit = async (e) => {
      e.preventDefault()

      try {
         const phone = `${formData.phone_country_code}${formData.phone}`

         const formDataToSend = new FormData()

         const payload = { ...formData, phone }

         for (const key in payload) {
            if (payload[key] !==undefined && payload[key] !== null && key !== 'player_image') {
               formDataToSend.append(key, payload[key])
            }
         }

         if (formData.player_image) {
            formDataToSend.append('avatar', formData.player_image)
         }

         const response = await axios.post('/api/players/', formDataToSend, {
            headers: {
               'Content-Type': 'multipart/form-data'
            }
         })

         if (response.status === 200) {
            setFormData(initialStates);
            setToastMessage('Player created successfully.');
            setToastVariant('success');
            setShowToast(true);
         }
      } catch (error) {
         let errorMessage = 'Something went wrong.';
         if (error.response?.data?.error) {
            errorMessage = error.response.data.error;
         }
         setToastMessage(errorMessage);
         setToastVariant('danger');
         setShowToast(true);
      }
   }
  
   return (
      <>
      <Container className="p-4 player-form-container">
            <h2>Create New Player</h2>
            <Form onSubmit={handleSubmit} className='mt-4'>
               <Row>
                  {/* PERSONAL INFORMATION */}
                  <Col md={6}>
                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="first_name" 
                        value={formData.first_name} 
                        onChange={handleChange} 
                        placeholder='First Name'
                        required />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="last_name" 
                        value={formData.last_name} 
                        onChange={handleChange} 
                        placeholder='Last Name'
                        required />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Label>Gender</Form.Label>
                     <div>
                        <Form.Check 
                        inline 
                        label="Male" 
                        name="gender" 
                        type="radio" 
                        id="gender-male" 
                        value="male" 
                        checked={formData.gender === 'male'}
                        onChange={handleChange}
                        />
                        <Form.Check 
                        inline 
                        label="Female" 
                        name="gender" 
                        type="radio" 
                        id="gender-female" 
                        value="female" 
                        checked={formData.gender === 'female'}
                        onChange={handleChange}
                        />
                        <Form.Check 
                        inline 
                        label="Other" 
                        name="gender" 
                        type="radio" 
                        id="gender-other" 
                        value="other" 
                        checked={formData.gender === 'other'}
                        onChange={handleChange}
                        />
                     </div>
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Label>Birth Date</Form.Label>
                     <Form.Control 
                        type="date" 
                        name="birth_date" 
                        value={formData.birth_date} 
                        onChange={handleChange} 
                     />
                  </Form.Group>
                  </Col>

                  {/* CONTACT INFORMATION */}
                  <Col md={6}>
                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="nick_name" 
                        value={formData.nick_name} 
                        onChange={handleChange} 
                        placeholder='Nickname (Optional)'
                     />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="email" 
                        name="email" 
                        value={formData.email} 
                        onChange={handleChange} 
                        placeholder='Email'
                        required />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <InputGroup>
                        <DropdownButton
                        variant="secondary"
                        title={formData.phone_country_code || '+1'}
                        onSelect={(selected) => setFormData({ ...formData, phone_country_code: selected })}
                        style={{ width: '120px'}}
                        >
                        <Dropdown.Item eventKey="+1">🇺🇸 +1 (USA)</Dropdown.Item>
                        <Dropdown.Item eventKey="+44">🇬🇧 +44 (UK)</Dropdown.Item>
                        <Dropdown.Item eventKey="+61">🇦🇺 +61 (Australia)</Dropdown.Item>
                        <Dropdown.Item eventKey="+971">🇦🇪 +971 (Dubai / UAE)</Dropdown.Item>
                        <Dropdown.Item eventKey="+63">🇵🇭 +63 (Philippines)</Dropdown.Item>
                        </DropdownButton>
                        <Form.Control 
                           type="text" 
                           name="phone" 
                           value={formData.phone} 
                           onChange={handleChange} 
                           inputMode='numeric'
                           pattern='[0-9]{10}'
                           minLength={7}
                           maxLength={15}
                           placeholder='Phone number'
                        />
                     </InputGroup>
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="rfid_uid_tag" 
                        value={formData.rfid_uid_tag || ""} 
                        onChange={handleChange}
                        placeholder="Scan or enter RFID tag"
                     />
                  </Form.Group>
                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="file" 
                        name="avatar"
                        placeholder="Add player's profile image."
                        accept="image/*" 
                        onChange={(e) => setFormData({ ...formData, player_image: e.target.files[0] })}
                     />
                  </Form.Group>
                  </Col>
               </Row>

               {/* LEAGUE INFORMATION */}
               <Row>
                  <Col md={6}>
                  <Form.Group className="mb-3">
                     <Form.Select 
                        name="league_country" 
                        value={formData.league_country} 
                        onChange={handleChange}
                     >
                        <option value="">League Country</option>
                        <option value="US">United States</option>
                        <option value="GB">United Kingdom</option>
                        <option value="AU">Australia</option>
                        <option value="PH">Philippines</option>
                        <option value="AE">Dubai / United Arab Emirates</option>
                     </Form.Select>
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="league_city" 
                        value={formData.league_city} 
                        onChange={handleChange} 
                        placeholder='League City'
                     />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="league_district" 
                        value={formData.league_district} 
                        onChange={handleChange} 
                        placeholder='League District'
                     />
                  </Form.Group>

                  <Form.Group className="mb-3">
                     <Form.Control 
                        type="text" 
                        name="league_other" 
                        value={formData.league_other} 
                        onChange={handleChange} 
                        placeholder='Other League Info'
                     />
                  </Form.Group>
                  </Col>

                  {/* NOTES */}
                  <Col md={6}>
                  <Form.Group className="mb-3">
                     <Form.Control 
                        as='textarea' 
                        name="notes"
                        value={formData.notes} 
                        onChange={handleChange} 
                        placeholder='Additional Notes'
                        style={{ height: '200px'}}
                     />
                  </Form.Group>
                  </Col>
               </Row>

               <div className='w-100 d-flex align-items center justify-content-center'>
                  <Button variant="primary" type="submit" style={{ width: '100px', height: '38px'}}>
                     Submit
                  </Button>
               </div>
            </Form>
      </Container>
      </>
   )
}

export default CreatePlayers