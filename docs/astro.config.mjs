// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'CKB Transaction Firewall',
			description: 'Public documentation for the CKB Transaction Firewall contracts, SDKs, CLI, and governance process.',
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
							'getting-started/how-to-use',
							'getting-started/overview',
							'getting-started/cli',
							'getting-started/typescript-sdk',
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
							'reference/blkl-format',
							'reference/firewall-lock-args',
							'reference/gov1-witness',
							'reference/error-codes',
							'reference/cli',
						],
					},
					{
						id: 'operations',
						label: 'Operations',
						link: '/operations/',
						icon: 'setting',
						items: [
							'operations/testnet-deployment',
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
