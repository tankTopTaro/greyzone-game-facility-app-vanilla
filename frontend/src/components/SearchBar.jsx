import { Button, Dropdown, Form, InputGroup } from "react-bootstrap"

const SearchBar = ({ category, query, setQuery, setCategory, handleSearchClick}) => {
   const formatCategoryText = (text) => {
      return text
         .replace(/_/g, " ") // Replace underscores with spaces
         .replace(/\b\w/g, (char) => char.toUpperCase()) // Capitalize first letter of each word
   }

  return (
   <div className="d-flex justify-content-center align-items-center mt-4">
      <InputGroup className="align-items-center" style={{width: '500px'}}>
         <Dropdown>
            <Dropdown.Toggle 
               className='dropdown-toggle'
               variant="secondary"  
               style={{ width: "120px", whiteSpace: "nowrap" }}
            >
               {formatCategoryText(category)}
            </Dropdown.Toggle>
            <Dropdown.Menu>
               <Dropdown.Item onClick={() => setCategory("email")}>Email</Dropdown.Item>
               <Dropdown.Item onClick={() => setCategory("phone")}>Phone</Dropdown.Item>
               <Dropdown.Item onClick={() => setCategory("last_name")}>Last name</Dropdown.Item>
               <Dropdown.Item onClick={() => setCategory("first_name")}>First name</Dropdown.Item>
            </Dropdown.Menu> 
         </Dropdown>

         <Form.Control
            className="shadow-none border rounded-0"
            type="text"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
         />
         <Button
            variant="secondary" 
            onClick={handleSearchClick}
         >
            <svg  xmlns="http://www.w3.org/2000/svg"  width={24}  height={24}  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  strokeWidth={2}  strokeLinecap="round"  strokeLinejoin="round"  className="icon icon-tabler icons-tabler-outline icon-tabler-search"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>
         </Button>
      </InputGroup>
   </div>
  )
}

export default SearchBar