import type {Metadata} from 'next';
import './styles.css';
export const metadata:Metadata={title:'Aide — Voice for every business',description:'Conversations that turn into action and insight.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
