// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics';

// https://astro.build/config
export default defineConfig({
	site: 'https://ckb-firewall.drreamer.digital',
	integrations: [
		starlight({
			title: 'CKB Transaction Firewall',
			description: 'Documentation for the CKB Transaction Firewall contracts, SDKs, CLI, and governance process.',
			favicon: '/favicon.ico',
			head: [
				{
					tag: 'link',
					attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
				},
			],
			logo: {
				src: '../assets/logo.png',
				alt: 'CKB Transaction Firewall',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/digitaldrreamer/ckb-transaction-firewall' },
			],
			editLink: {
				baseUrl: 'https://github.com/digitaldrreamer/ckb-transaction-firewall/edit/main/docs/src/content/docs/',
			},
			plugins: [
				starlightThemeRapide(),
				starlightSidebarTopics([
					{
						id: 'getting-started',
						label: 'Getting Started',
						link: '/getting-started/',
						icon: 'rocket',
						items: [
							'getting-started/tutorial',
							'getting-started/overview',
							'getting-started/how-to-use',
							'getting-started/blacklist-guide',
							'getting-started/cli',
							'getting-started/typescript-sdk',
							'getting-started/wallet-integration',
							'getting-started/rust-sdk',
						],
					},
					{
						id: 'concepts',
						label: 'Concepts',
						link: '/concepts/',
						icon: 'open-book',
						items: [
							'concepts/why-this-exists',
							'concepts/architecture',
							'concepts/firewall-lock',
							'concepts/inner-lock',
							'concepts/blacklist-registry',
							'concepts/governance',
							'concepts/security-model',
						],
					},
					{
						id: 'reference',
						label: 'Reference',
						link: '/reference/',
						icon: 'information',
						items: [
							'reference/sdk-api',
							'reference/blkl-format',
							'reference/firewall-lock-args',
							'reference/gov1-witness',
							'reference/error-codes',
							'reference/cli',
							'reference/glossary',
						],
					},
					{
						id: 'operations',
						label: 'Operations',
						link: '/operations/',
						icon: 'setting',
						items: [
							'operations/testnet-deployment',
							'operations/governance-runbook',
							'operations/private-registry',
							'operations/troubleshooting',
						],
					},
				], {
					exclude: ['index'],
				}),
			],
		}),
	],
});
