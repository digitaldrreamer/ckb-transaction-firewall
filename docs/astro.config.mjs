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
				{
					tag: 'link',
					attrs: { rel: 'stylesheet', href: '/preview.css' },
				},
				{
					tag: 'script',
					attrs: { src: '/preview.js', defer: true },
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
							'getting-started/choose-your-path',
						],
					},
					{
						id: 'guides',
						label: 'Guides',
						link: '/guides/',
						icon: 'list-format',
						items: [
							'guides/governance-how-to-use',
							{
								label: 'TypeScript SDK',
								items: [
									'guides/typescript-preflight',
									'guides/typescript-wallet-integration',
								],
							},
							{
								label: 'Rust SDK',
								items: [
									'guides/rust-preflight',
								],
							},
							{
								label: 'CLI & GUI',
								items: [
									'guides/cli-walkthrough',
									'guides/cli-gui',
								],
							},
							{
								label: 'Governance',
								items: [
									'guides/governance-blacklist',
								],
							},
						],
					},
					{
						id: 'concepts',
						label: 'Concepts',
						link: '/concepts/',
						icon: 'open-book',
						items: [
							'concepts/why-this-exists',
							'concepts/overview',
							'concepts/architecture',
							'concepts/firewall-lock',
							'concepts/inner-lock',
							'concepts/blacklist-registry',
							'concepts/governance',
							'concepts/registry-treasury',
							'concepts/security-model',
						],
					},
					{
						id: 'reference',
						label: 'Reference',
						link: '/reference/',
						icon: 'information',
						items: [
							{
								label: 'TypeScript SDK',
								items: ['reference/sdk-api'],
							},
							{
								label: 'Rust SDK',
								items: ['reference/rust-sdk-api'],
							},
							{
								label: 'CLI',
								items: ['reference/cli'],
							},
							{
								label: 'Data Formats',
								items: [
									'reference/blkl-format',
									'reference/firewall-lock-args',
									'reference/gov1-witness',
								],
							},
							'reference/error-codes',
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
