/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Dashboard from './components/Dashboard';
import { Toaster } from 'sonner';
import './index.css';

export default function App() {
  return (
    <>
      <Toaster position="top-right" theme="dark" />
      <Dashboard />
    </>
  );
}
