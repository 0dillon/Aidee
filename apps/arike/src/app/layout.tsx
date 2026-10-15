import type {Metadata} from 'next';
import './styles.css';
export const metadata:Metadata={title:'Arike Pre-order',description:'Clothing made with care, ordered in your own way.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
