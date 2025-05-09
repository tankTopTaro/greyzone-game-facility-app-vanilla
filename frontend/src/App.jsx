import { Routes, Route } from 'react-router-dom'
import Monitor from './pages/Monitor'

const App = () => {
  return (
    <Routes>
      <Route path='/monitor' element={<Monitor />} />
    </Routes>
  )
}

export default App
