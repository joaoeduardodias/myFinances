import {
  ChartPieIcon,
  CreditCardIcon,
  FileTextIcon,
  HomeIcon,
  LogOutIcon,
  PlugIcon,
  RepeatIcon,
  WalletIcon,
} from 'lucide-react'
import { NavLink, useMatch } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Logo } from '@/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const navItems = [
  { to: '/', label: 'Início', icon: HomeIcon, end: true },
  { to: '/transacoes', label: 'Transações', icon: WalletIcon },
  { to: '/analise', label: 'Análise', icon: ChartPieIcon },
  { to: '/cartoes', label: 'Cartões', icon: CreditCardIcon },
  { to: '/recorrentes', label: 'Recorrentes', icon: RepeatIcon },
  { to: '/holerites', label: 'Holerites', icon: FileTextIcon },
  { to: '/conexoes', label: 'Conexões', icon: PlugIcon },
]

function NavItem({ item }: { item: (typeof navItems)[number] }) {
  // O `NavLink` responde pela acessibilidade (`aria-current`) e o `useMatch`
  // pelo destaque visual: a mesma pergunta, com a mesma regra de `end`.
  const isActive = !!useMatch({ path: item.to, end: item.end ?? false })

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <NavLink to={item.to} end={item.end}>
          <item.icon />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { user, signOut } = useAuth()

  return (
    <Sidebar collapsible="icon" role="navigation" aria-label="Navegação">
      <SidebarHeader>
        <Logo
          className="px-1 text-lg"
          nameClassName="group-data-[collapsible=icon]:hidden"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <NavItem key={item.to} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sair" onClick={signOut}>
              <LogOutIcon />
              <span className="truncate">
                Sair{user ? ` (${user.name})` : ''}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
