<template>
    <div class="minimal-layout">
        <!-- Optional Simple Header -->
        <header v-if="showHeader" class="minimal-header">
            <div class="container-fluid">
                <div class="row align-items-center py-3">
                    <div class="col-6">
                        <div class="brand">
                            <img v-if="logo" :src="logo" alt="Logo" class="brand-logo me-2">
                            <span class="brand-name">{{ brandName }}</span>
                        </div>
                    </div>
                    <div class="col-6 text-end">
                        <div class="header-actions">
                            <!-- Language Selector (if enabled) -->
                            <div v-if="showLanguageSelector" class="language-selector me-3">
                                <select
                                    v-model="$root.language"
                                    class="form-select form-select-sm"
                                    @change="$root.changeLanguage($root.language)"
                                >
                                    <option value="zh-HK">繁中</option>
                                    <option value="zh-CN">简中</option>
                                    <option value="en">English</option>
                                    <option value="ja">日本語</option>
                                    <!-- Add more languages as needed -->
                                </select>
                            </div>

                            <!-- Theme Toggle -->
                            <button
                                v-if="showThemeToggle"
                                class="btn btn-outline-secondary btn-sm"
                                :title="$t('Toggle Dark Mode')"
                                @click="$root.toggleDarkMode()"
                            >
                                <font-awesome-icon
                                    :icon="$root.theme === 'dark' ? 'sun' : 'moon'"
                                />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="minimal-main">
            <router-view />
        </main>

        <!-- Optional Simple Footer -->
        <footer v-if="showFooter" class="minimal-footer">
            <div class="container-fluid">
                <div class="row py-3">
                    <div class="col-md-6">
                        <p class="mb-0 text-muted small">
                            {{ footerText }}
                        </p>
                    </div>
                    <div class="col-md-6 text-end">
                        <div class="footer-links">
                            <a
                                v-for="link in footerLinks"
                                :key="link.name"
                                :href="link.url"
                                class="text-muted small text-decoration-none me-3"
                                :target="link.external ? '_blank' : '_self'"
                                :rel="link.external ? 'noopener noreferrer' : ''"
                            >
                                {{ link.name }}
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>

        <!-- Toast Notifications -->
        <Teleport to="body">
            <div id="toast-container"></div>
        </Teleport>
    </div>
</template>

<script>
import deploymentConfig from "../modules/deployment-config.js";

export default {
    name: "MinimalLayout",

    data() {
        return {
            config: null,
        };
    },

    computed: {
        showHeader() {
            // Show header based on deployment configuration
            return this.config?.publicAccess?.showHeader !== false;
        },

        showFooter() {
            // Show footer based on deployment configuration
            return this.config?.publicAccess?.showFooter !== false;
        },

        showLanguageSelector() {
            // Language selector for external customers
            return this.config?.publicAccess?.allowLanguageChange !== false;
        },

        showThemeToggle() {
            // Theme toggle for better user experience
            return this.config?.publicAccess?.allowThemeToggle !== false;
        },

        brandName() {
            // Get brand name from config or use default
            return this.config?.publicAccess?.brandName || "Service Status";
        },

        logo() {
            // Get logo from config
            return this.config?.publicAccess?.logo || null;
        },

        footerText() {
            return this.config?.publicAccess?.footerText ||
                   `© ${new Date().getFullYear()} Service Status Dashboard`;
        },

        footerLinks() {
            // Default footer links - can be configured
            return this.config?.publicAccess?.footerLinks || [
                { name: "Support",
                    url: "/support",
                    external: false },
                { name: "Documentation",
                    url: "/docs",
                    external: false },
                { name: "Contact",
                    url: "/contact",
                    external: false }
            ];
        }
    },

    watch: {
        "$route"() {
            this.updatePageTitle();
        }
    },

    async mounted() {
        // Load deployment configuration
        this.config = await deploymentConfig.getConfig();

        // Subscribe to config changes
        this.unsubscribe = deploymentConfig.subscribe((newConfig) => {
            this.config = newConfig;
        });

        // Set page title based on route meta
        this.updatePageTitle();
    },

    beforeUnmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    },

    methods: {
        updatePageTitle() {
            const routeTitle = this.$route.meta?.title;
            if (routeTitle) {
                document.title = `${routeTitle} | ${this.brandName}`;
            }
        }
    }
};
</script>

<style lang="scss" scoped>
.minimal-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background-color: #f8f9fa;
}

.minimal-header {
    background: white;
    border-bottom: 1px solid #e9ecef;
    position: sticky;
    top: 0;
    z-index: 1000;

    .brand {
        display: flex;
        align-items: center;

        .brand-logo {
            height: 32px;
            width: auto;
        }

        .brand-name {
            font-size: 1.25rem;
            font-weight: 600;
            color: #2c3e50;
        }
    }

    .header-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;

        .language-selector select {
            min-width: 120px;
        }
    }
}

.minimal-main {
    flex: 1;
    padding: 0;
}

.minimal-footer {
    background: white;
    border-top: 1px solid #e9ecef;
    margin-top: auto;

    .footer-links a {
        &:hover {
            color: #495057 !important;
            text-decoration: underline !important;
        }
    }
}

// Dark mode support
[data-bs-theme="dark"] {
    .minimal-layout {
        background-color: #1a1a1a;
    }

    .minimal-header,
    .minimal-footer {
        background: #2c2c2c;
        border-color: #495057;
    }

    .brand-name {
        color: #f8f9fa;
    }
}

// Mobile responsive
@media (max-width: 768px) {
    .minimal-header {
        .header-actions {
            .language-selector {
                margin-right: 0.5rem !important;
            }

            .language-selector select {
                min-width: 90px;
                font-size: 0.875rem;
            }
        }
    }

    .minimal-footer {
        .row {
            text-align: center;

            .col-md-6:last-child {
                margin-top: 0.5rem;
            }
        }

        .footer-links a {
            display: block;
            margin: 0.25rem 0;
        }
    }
}

// Print styles
@media print {
    .minimal-header,
    .minimal-footer {
        display: none;
    }

    .minimal-main {
        padding: 0;
    }
}
</style>
