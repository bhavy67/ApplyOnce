import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserProfileRepository } from '../storage';
import { ProfilePage } from './ProfilePage';
import './profile-page.css';

const container = document.getElementById('root');
if (!container) throw new Error('Profile page root element is missing');

const repository = createBrowserProfileRepository();

createRoot(container).render(
  <StrictMode>
    <ProfilePage repository={repository} />
  </StrictMode>,
);
