import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, Globe, Sparkles, X } from 'lucide-react';
import { generatePortfolioWebsite, generateProfessionalHeadshot } from '../../services/aiClient';
import type { PortfolioWebsiteResult, PortfolioContent, SkillBridgeProject, UserProfile } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { useToast } from '../Toast';
import ConfirmActionDialog from '../ConfirmActionDialog';
import { ToolError } from './ToolUtils';
import type { AppSession as Session } from '../../lib/data';
import PortfolioPreviewViewer, { applyPortfolioTheme, PORTFOLIO_TEMPLATES } from '../showcase/PortfolioPreviewViewer';
import {
  deletePortfolioDraft,
  loadPortfolioDraft,
  portfolioDraftResumeFingerprint,
  savePortfolioDraft,
  type PortfolioDraftDetails,
  type PortfolioDraftInput,
  type PortfolioDraftProject,
} from '../../services/portfolioDraft';
import { defaultPortfolioName, savePortfolio } from '../../services/savedPortfolios';

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Professional Portfolio</title>
    <style>
        :root { --primary: #2563eb; --secondary: #64748b; --dark: #1e293b; --light: #f8fafc; --accent: #f97316; --transition: all 0.3s ease; --surface-card: white; --header-bg: rgba(255, 255, 255, 0.95); }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        html { scroll-behavior: smooth; }
        body { background-color: var(--light); color: var(--dark); line-height: 1.6; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .container { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 0; }
        section { padding: 80px 0; }
        .section-title { text-align: center; margin-bottom: 50px; position: relative; }
        .section-title h2 { font-size: 2.5rem; color: var(--dark); margin-bottom: 15px; }
        .section-title::after { content: ''; position: absolute; width: 80px; height: 4px; background-color: var(--primary); bottom: -10px; left: 50%; transform: translateX(-50%); }
        .btn { display: inline-block; padding: 12px 28px; background-color: var(--primary); color: white; border-radius: 5px; text-decoration: none; font-weight: 600; transition: var(--transition); border: none; cursor: pointer; }
        .btn:hover, .btn:focus-visible { background-color: var(--dark); transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1); }
        a:focus-visible, button:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 55%, white); outline-offset: 3px; }
        header { position: sticky; top: 0; width: 100%; z-index: 1000; background-color: var(--header-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); padding: 15px 0; }
        nav { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.8rem; font-weight: 700; color: var(--primary); }
        .logo span { color: var(--accent); }
        .nav-links { display: flex; list-style: none; }
        .nav-links li { margin-left: 30px; }
        .nav-links a { text-decoration: none; color: var(--dark); font-weight: 500; transition: var(--transition); }
        .nav-links a:hover { color: var(--primary); }
        .menu-btn { display: none; background: transparent; border: 0; border-radius: 10px; color: var(--dark); cursor: pointer; font-size: 1.5rem; line-height: 1; padding: 8px 10px; }
        .menu-btn span { display: block; width: 24px; height: 2px; margin: 5px 0; background: currentColor; border-radius: 999px; }
        .hero { padding-top: 96px; padding-bottom: 80px; display: flex; align-items: center; min-height: calc(100vh - 76px); }
        .hero .container > div { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 30px; }
        .hero-content { flex: 1; }
        .hero-content h1 { font-size: 3.5rem; margin-bottom: 20px; color: var(--dark); }
        .hero-content h1 span { color: var(--primary); }
        .hero-content p { font-size: 1.2rem; margin-bottom: 30px; color: var(--secondary); max-width: 500px; }
        .hero-image { flex: 1; text-align: center; max-width: 400px; }
        .profile-img { width: 350px; height: 350px; border-radius: 50%; object-fit: cover; border: 5px solid var(--primary); box-shadow: 0 15px 30px rgba(0, 0, 0, 0.1); }
        .profile-initials { display: inline-flex; align-items: center; justify-content: center; background: var(--primary); color: white; font-size: 5.5rem; font-weight: 800; letter-spacing: 0; }
        .social-icons { margin-top: 20px; }
        .social-icons { display: flex; flex-wrap: wrap; gap: 10px; }
        .social-icons a { display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center; background-color: var(--primary); color: white; border-radius: 50%; text-align: center; text-decoration: none; transition: var(--transition); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.03em; }
        .social-icons a:hover, .social-icons a:focus-visible { background-color: var(--accent); transform: translateY(-5px); }
        .about-content { display: flex; align-items: center; gap: 50px; }
        .about-text { width: 100%; }
        .about-text h3 { font-size: 2rem; margin-bottom: 20px; color: var(--dark); }
        .about-text p { margin-bottom: 15px; color: var(--secondary); }
        .skills-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 30px; }
        .skill { background-color: var(--surface-card, white); padding: 30px; border-radius: 10px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05); transition: var(--transition); text-align: center; }
        .skill:hover { transform: translateY(-10px); box-shadow: 0 15px 30px rgba(0, 0, 0, 0.1); }
        .skill-icon { display: inline-flex; width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: 16px; background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); font-size: 1rem; font-weight: 800; margin-bottom: 18px; }
        .skill h3 { font-size: 1.5rem; margin-bottom: 15px; color: var(--dark); }
        .skill p { color: var(--secondary); }
        .portfolio-filter { display: flex; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
        .filter-btn { padding: 8px 20px; background-color: var(--surface-card, white); color: var(--dark); border: 1px solid #ddd; margin: 5px; cursor: pointer; border-radius: 999px; transition: var(--transition); font-weight: 600; }
        .filter-btn.active, .filter-btn:hover, .filter-btn:focus-visible { background-color: var(--primary); color: white; border-color: var(--primary); }
        .portfolio-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 25px; }
        .portfolio-item { position: relative; border-radius: 10px; overflow: hidden; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); height: 250px; }
        .portfolio-item img, .portfolio-placeholder { width: 100%; height: 100%; transition: var(--transition); }
        .portfolio-item img { object-fit: cover; }
        .portfolio-placeholder { display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; padding: 28px; background: color-mix(in srgb, var(--primary) 10%, var(--surface-card)); color: var(--dark); }
        .project-kicker { align-self: flex-start; border-radius: 999px; background: var(--surface-card); color: var(--primary); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.02em; padding: 6px 10px; }
        .project-title { max-width: 18rem; font-size: 1.45rem; line-height: 1.15; }
        .portfolio-item:hover img, .portfolio-item:focus-within img, .portfolio-item:hover .portfolio-placeholder, .portfolio-item:focus-within .portfolio-placeholder { transform: scale(1.06); }
        .portfolio-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(37, 99, 235, 0.9); display: flex; flex-direction: column; justify-content: center; align-items: center; opacity: 0; transition: var(--transition); padding: 20px; text-align: center; }
        .portfolio-item:hover .portfolio-overlay, .portfolio-item:focus-within .portfolio-overlay { opacity: 1; }
        .portfolio-overlay h3 { color: white; font-size: 1.5rem; margin-bottom: 10px; }
        .portfolio-overlay p { color: rgba(255, 255, 255, 0.9); }
        .timeline { position: relative; max-width: 800px; margin: 0 auto; }
        .timeline::after { content: ''; position: absolute; width: 6px; background-color: #e2e8f0; top: 0; bottom: 0; left: 50%; margin-left: -3px; border-radius: 3px; }
        .timeline-item { position: relative; width: 50%; margin-bottom: 50px; }
        .timeline-item::after { content: ''; position: absolute; width: 20px; height: 20px; background-color: var(--surface-card, white); border: 4px solid var(--primary); top: 15px; border-radius: 50%; z-index: 1; }
        .timeline-item:nth-child(odd) { left: 0; padding-right: 50px; text-align: right; }
        .timeline-item:nth-child(odd)::after { right: -10px; }
        .timeline-item:nth-child(even) { left: 50%; padding-left: 50px; }
        .timeline-item:nth-child(even)::after { left: -10px; }
        .timeline-content { padding: 20px; background-color: var(--surface-card, white); border-radius: 10px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
        .timeline-date { font-weight: 600; color: var(--primary); margin-bottom: 10px; font-size: 0.9rem; }
        .timeline-content h3 { margin-bottom: 5px; font-size: 1.2rem; color: var(--dark); }
        .timeline-content h3 + p { font-style: italic; color: var(--secondary); margin-bottom: 10px; font-size: 1rem; }
        .contact-container { display: grid; grid-template-columns: 1fr 1.5fr; gap: 50px; align-items: flex-start; }
        .contact-info { display: flex; flex-direction: column; }
        .contact-item { display: flex; align-items: flex-start; margin-bottom: 25px; }
        .contact-icon { flex: 0 0 auto; display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 12px; background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); font-size: 0.8rem; font-weight: 800; margin-right: 15px; text-align: center; }
        .contact-text h3 { margin-bottom: 5px; color: var(--dark); }
        .contact-text p { color: var(--secondary); }
        .contact-card { background-color: var(--surface-card, white); padding: 30px; border-radius: 14px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05); }
        .contact-card h3 { color: var(--dark); font-size: 1.5rem; margin-bottom: 12px; }
        .contact-card p { color: var(--secondary); margin-bottom: 20px; }
        footer { background-color: var(--dark); color: white; padding: 50px 0 20px; text-align: center; }
        .footer-content { margin-bottom: 30px; }
        .footer-content h2 { font-size: 2rem; margin-bottom: 20px; }
        .footer-content p { max-width: 600px; margin: 0 auto 30px; }
        .copyright { padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.9rem; color: var(--secondary); }
        @media (max-width: 992px) {
            .hero .container > div { flex-direction: column-reverse; text-align: center; }
            .hero-content { padding-right: 0; margin-top: 40px; }
            .hero-content p { margin-left: auto; margin-right: auto; }
            .profile-img { width: 280px; height: 280px; }
            .timeline::after { left: 15px; }
            .timeline-item { width: 100%; padding-left: 50px; padding-right: 0; text-align: left !important; }
            .timeline-item:nth-child(even) { left: 0; }
            .timeline-item::after { left: 5px !important; }
            .contact-container { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
            .menu-btn { display: block; }
            .nav-links { position: fixed; top: 72px; left: -100%; width: 100%; height: calc(100vh - 72px); background-color: var(--light); flex-direction: column; align-items: center; justify-content: center; transition: var(--transition); }
            .nav-links.active { left: 0; }
            .nav-links li { margin: 15px 0; }
            .hero-content h1 { font-size: 2.5rem; }
            .section-title h2 { font-size: 2rem; }
        }
        @media (max-width: 480px) {
            section { padding: 56px 0; }
            .container { width: min(100% - 24px, 1120px); }
            .hero { padding-top: 72px; min-height: auto; }
            .hero-content h1 { font-size: 2.1rem; line-height: 1.15; }
            .hero-content p { font-size: 1rem; }
            .profile-img { width: min(230px, 80vw); height: min(230px, 80vw); }
            .skills-container, .portfolio-grid { gap: 18px; }
            .skill, .contact-card, .timeline-content { padding: 20px; }
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <nav>
                <div class="logo">Port<span>folio</span></div>
                <ul id="site-navigation" class="nav-links">
                    <li><a href="#home">Home</a></li>
                    <li><a href="#about">About</a></li>
                    <li><a href="#skills">Skills</a></li>
                    <li><a href="#portfolio">Portfolio</a></li>
                    <li><a href="#experience">Experience</a></li>
                    <li><a href="#contact">Contact</a></li>
                </ul>
                <button type="button" class="menu-btn" aria-label="Open navigation" aria-controls="site-navigation" aria-expanded="false">
                    <span></span><span></span><span></span>
                </button>
            </nav>
        </div>
    </header>

    <section id="home" class="hero">
        <div class="container">
            <div>
                <div class="hero-content">
                    <h1>Hi, I'm <span>Alex Johnson</span></h1>
                    <p>A passionate UI/UX Designer.</p>
                    <a href="#contact" class="btn">Get In Touch</a>
                    <div class="social-icons">
                        <!-- SOCIAL ICONS - HERO -->
                    </div>
                </div>
                <div class="hero-image">
                    <!-- PROFILE IMAGE -->
                </div>
            </div>
        </div>
    </section>

    <section id="about" class="about">
        <div class="container">
            <div class="section-title"><h2>About Me</h2></div>
            <div class="about-content">
                <div class="about-text">
                    <!-- BIO -->
                    <!-- PROFILE CTA -->
                </div>
            </div>
        </div>
    </section>

    <section id="skills" class="skills">
        <div class="container">
            <div class="section-title"><h2>My Skills</h2></div>
            <div class="skills-container">
                <!-- SKILLS -->
            </div>
        </div>
    </section>

    <section id="portfolio" class="portfolio">
        <div class="container">
            <div class="section-title"><h2>My Portfolio</h2></div>
            <div class="portfolio-filter">
                <button type="button" class="filter-btn active" data-filter="all">All</button>
                <button type="button" class="filter-btn" data-filter="web">Web</button>
                <button type="button" class="filter-btn" data-filter="app">App</button>
                <button type="button" class="filter-btn" data-filter="branding">Branding</button>
            </div>
            <div class="portfolio-grid">
                <!-- PORTFOLIO ITEMS -->
            </div>
        </div>
    </section>

    <section id="experience" class="experience">
        <div class="container">
            <div class="section-title"><h2>Work Experience</h2></div>
            <div class="timeline">
                <!-- EXPERIENCE -->
            </div>
        </div>
    </section>

    <section id="contact" class="contact">
        <div class="container">
            <div class="section-title"><h2>Get In Touch</h2></div>
            <div class="contact-container">
                <div class="contact-info">
                    <div class="contact-item">
                        <span class="contact-icon" aria-hidden="true">@</span>
                        <div class="contact-text">
                            <h3>Email</h3>
                            <p><!-- EMAIL --></p>
                        </div>
                    </div>
                    <div class="contact-item">
                        <span class="contact-icon" aria-hidden="true">TEL</span>
                        <div class="contact-text">
                            <h3>Phone</h3>
                            <p><!-- PHONE --></p>
                        </div>
                    </div>
                    <div class="contact-item">
                        <span class="contact-icon" aria-hidden="true">LOC</span>
                        <div class="contact-text">
                            <h3>Location</h3>
                            <p><!-- LOCATION --></p>
                        </div>
                    </div>
                </div>
                <div class="contact-card">
                    <h3>Start a conversation</h3>
                    <p>If this work matches what you are building, the fastest next step is a short email with the role, team, and timeline.</p>
                    <!-- EMAIL CTA -->
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="social-icons">
                    <!-- SOCIAL ICONS - FOOTER -->
                </div>
            </div>
            <div class="copyright"><p>&copy; 2023 Alex Johnson. All Rights Reserved.</p></div>
        </div>
    </footer>

    <script>
        const menuBtn = document.querySelector('.menu-btn');
        const navLinks = document.querySelector('.nav-links');
        if (menuBtn && navLinks) {
            menuBtn.addEventListener('click', () => {
                const isOpen = navLinks.classList.toggle('active');
                menuBtn.setAttribute('aria-expanded', String(isOpen));
            });
        }
        
        const filterBtns = document.querySelectorAll('.filter-btn');
        if (filterBtns.length > 0) {
            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    filterBtns.forEach(b => b.setAttribute('aria-pressed', 'false'));
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');
                    const filterValue = btn.getAttribute('data-filter');
                    document.querySelectorAll('.portfolio-item').forEach(item => {
                        const itemCategory = item.getAttribute('data-category');
                        if (filterValue === 'all' || itemCategory === filterValue) {
                            item.style.display = 'block';
                        } else {
                            item.style.display = 'none';
                        }
                    });
                });
            });
        }

        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                if (targetId === '#') return;
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    window.scrollTo({ top: targetElement.offsetTop - 70, behavior: 'smooth' });
                    if (navLinks && navLinks.classList.contains('active')) {
                        navLinks.classList.remove('active');
                        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
                    }
                }
            });
        });
    </script>
</body>
</html>
`;


interface HeadshotImage {
  mimeType: string;
  data: string;
}

interface Project {
  id: number;
  title: string;
  description: string;
  url: string;
  category: string;
  image?: HeadshotImage;
}

const compact = (value: string | null | undefined): string => value?.trim().replace(/\s+/g, ' ') ?? '';

const truncate = (value: string, maxLength: number): string => {
    const text = compact(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}...`;
};

const isBlankProject = (project: Project): boolean =>
    !compact(project.title) && !compact(project.description) && !compact(project.url);

let projectIdSequence = Date.now();
const createProjectId = (): number => {
    projectIdSequence += 1;
    return projectIdSequence;
};

const DEFAULT_PROJECT: Project = { id: 1, title: '', description: '', url: '', category: 'Web' };

const toDraftProject = (project: Project): PortfolioDraftProject => ({
    title: project.title,
    description: project.description,
    url: project.url,
    category: project.category,
});

const fromDraftProject = (project: PortfolioDraftProject, index: number): Project => ({
    id: createProjectId() + index,
    title: project.title,
    description: project.description,
    url: project.url,
    category: project.category || 'Web',
});

const buildDraftSnapshot = (
    resumeFingerprint: string,
    content: PortfolioContent | null,
    details: PortfolioDraftDetails,
    projects: Project[],
): PortfolioDraftInput => ({
    resume_fingerprint: resumeFingerprint,
    content,
    details: {
        tagline: details.tagline,
        bio: details.bio,
        theme: details.theme,
    },
    projects: projects.map(toDraftProject),
});

const isMeaningfulDraft = (draft: PortfolioDraftInput): boolean => (
    Boolean(draft.content) ||
    Boolean(compact(draft.details.tagline)) ||
    Boolean(compact(draft.details.bio)) ||
    draft.projects.some(project => compact(project.title) || compact(project.description) || compact(project.url))
);

const serializeDraftSnapshot = (draft: PortfolioDraftInput): string => JSON.stringify(draft);

const buildTaglineFromContent = (content: PortfolioContent): string => {
    const currentRole = compact(content.experience?.[0]?.title);
    const categories = (content.skills ?? [])
        .map(skill => compact(skill.category))
        .filter(Boolean)
        .slice(0, 2);
    const base = currentRole || categories[0] || 'Professional Portfolio';
    const extras = categories.filter(category => category.toLowerCase() !== base.toLowerCase());
    return truncate([base, ...extras].join(' | '), 140);
};

const buildBioFromContent = (content: PortfolioContent): string => {
    const name = compact(content.fullName) || 'This professional';
    const recent = content.experience?.[0];
    const role = compact(recent?.title);
    const company = compact(recent?.company);
    const location = compact(content.contactLocation);
    const skillCategories = (content.skills ?? [])
        .map(skill => compact(skill.category))
        .filter(Boolean)
        .slice(0, 3);
    const strongestSkill = compact(content.skills?.[0]?.description);
    const strongestExperience = compact(recent?.description);

    const sentences = [
        role
            ? `${name} is a ${role}${company ? ` with experience at ${company}` : ''}${location ? `, based in ${location}` : ''}.`
            : `${name} brings a professional background${location ? ` based in ${location}` : ''}.`,
        skillCategories.length > 0 ? `Their work spans ${skillCategories.join(', ')}.` : '',
        strongestSkill || strongestExperience,
    ].filter(Boolean);

    return truncate(sentences.join(' '), 700);
};

const buildProjectsFromContent = (content: PortfolioContent): Project[] => {
    const explicitProjects = (content.projects ?? [])
        .filter(project => compact(project.title) || compact(project.description))
        .slice(0, 4)
        .map((project, index) => ({
            id: createProjectId() + index,
            title: truncate(compact(project.title), 120),
            description: truncate(compact(project.description), 420),
            url: compact(project.url),
            category: truncate(compact(project.category) || 'Project', 60),
        }));

    if (explicitProjects.length > 0) return explicitProjects;

    const fromExperience = (content.experience ?? [])
        .filter(exp => compact(exp.title) || compact(exp.description))
        .slice(0, 3)
        .map((exp, index) => ({
            id: createProjectId() + index,
            title: truncate([compact(exp.title), compact(exp.company)].filter(Boolean).join(' at '), 120),
            description: truncate(compact(exp.description), 420),
            url: '',
            category: 'Experience',
        }));

    if (fromExperience.length > 0) return fromExperience;

    const fromSkills = (content.skills ?? [])
        .filter(skill => compact(skill.category) || compact(skill.description))
        .slice(0, 3)
        .map((skill, index) => ({
            id: createProjectId() + index,
            title: truncate(compact(skill.category), 120),
            description: truncate(compact(skill.description), 420),
            url: '',
            category: 'Skill Area',
        }));

    return fromSkills.length > 0
        ? fromSkills
        : [{ id: createProjectId(), title: '', description: '', url: '', category: 'Web' }];
};

const resizeImage = (file: File, maxSize: number): Promise<{ mimeType: string; data: string; }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (!e.target?.result) return reject(new Error("FileReader error"));
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Could not get canvas context'));
                
                ctx.drawImage(img, 0, 0, width, height);
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                const base64Data = dataUrl.split(',')[1];
                if (base64Data) {
                    resolve({ mimeType: 'image/jpeg', data: base64Data });
                } else {
                    reject(new Error('Could not convert canvas to base64'));
                }
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result as string;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
};

interface BuildHtmlProps {
    content: PortfolioContent;
    branding: { tagline: string; bio: string; };
    projects: Project[];
    headshot: HeadshotImage | null;
}

// Helper functions for security
const escapeHtml = (unsafe: string | null | undefined): string => {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const escapeAttr = (unsafe: string | null | undefined): string => {
    if (!unsafe) return '';
    return escapeHtml(unsafe);
};

const normalizeExternalUrl = (unsafe: string | null | undefined): string => {
    const value = unsafe?.trim();
    if (!value) return '';
    if (/^(javascript|data|vbscript):/i.test(value)) return '';
    if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
    if (/^(www\.|[a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i.test(value)) return `https://${value}`;
    return '';
};

const buildPersonInitials = (content: PortfolioContent): string => {
    const initials = `${content.firstName?.[0] ?? ''}${content.lastName?.[0] ?? ''}`.toUpperCase() || 'ME';
    return initials.slice(0, 2);
};

const buildProfileImageHtml = (content: PortfolioContent, headshot: HeadshotImage | null): string => {
    if (headshot) {
        const src = `data:${headshot.mimeType};base64,${headshot.data}`;
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(`Profile image of ${content.fullName}`)}" class="profile-img">`;
    }
    return `<div class="profile-img profile-initials" role="img" aria-label="${escapeAttr(`Initials for ${content.fullName}`)}"><span>${escapeHtml(buildPersonInitials(content))}</span></div>`;
};

const buildProjectMediaHtml = (project: Project): string => {
    if (project.image) {
        const src = `data:${project.image.mimeType};base64,${project.image.data}`;
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(project.title || project.category || 'Portfolio item')}">`;
    }
    const title = escapeHtml(truncate(project.title || project.category || 'Project', 54));
    const category = escapeHtml(project.category || 'Portfolio item');
    return `<div class="portfolio-placeholder" aria-hidden="true"><span class="project-kicker">${category}</span><strong class="project-title">${title}</strong></div>`;
};

const buildSkillInitials = (category: string | null | undefined): string => {
    const value = compact(category);
    if (!value) return 'SK';
    const words = value.split(/[\s/&|,+-]+/).filter(Boolean);
    const initials = words.length > 1
        ? words.slice(0, 2).map(word => word[0]).join('')
        : value.slice(0, 2);
    return initials.toUpperCase();
};

const buildHtml = ({ content, branding, projects, headshot }: BuildHtmlProps): string => {
    let html = HTML_TEMPLATE;
    
    // Simple text replacements
    html = html.replace(/Alex Johnson/g, escapeHtml(content.fullName));
    html = html.replace(/Port<span>folio<\/span>/g, `${escapeHtml(content.firstName)}<span>${escapeHtml(content.lastName)}</span>`);
    html = html.replace(/A passionate UI\/UX Designer./g, escapeHtml(branding.tagline));
    
    // Bio with newlines
    const escapedBio = escapeHtml(branding.bio);
    html = html.replace('<!-- BIO -->', `<p>${escapedBio.replace(/\n/g, '</p><p>')}</p>`);

    const linkedinUrl = normalizeExternalUrl(content.socials?.linkedin);
    html = html.replace(
        '<!-- PROFILE CTA -->',
        linkedinUrl
            ? `<a href="${escapeAttr(linkedinUrl)}" target="_blank" rel="noopener noreferrer" class="btn">View Profile on LinkedIn</a>`
            : ''
    );

    html = html.replace('<!-- EMAIL -->', escapeHtml(content.contactEmail || 'N/A'));
    html = html.replace(
        '<!-- EMAIL CTA -->',
        content.contactEmail
            ? `<a href="mailto:${escapeAttr(content.contactEmail)}" class="btn">Send Message</a>`
            : '<span class="btn" aria-disabled="true">Email unavailable</span>'
    );
    html = html.replace('<!-- PHONE -->', escapeHtml(content.contactPhone || 'N/A'));
    html = html.replace('<!-- LOCATION -->', escapeHtml(content.contactLocation || 'N/A'));
    html = html.replace(/&copy; \d{4} Alex Johnson/g, `&copy; ${new Date().getFullYear()} ${escapeHtml(content.fullName)}`);

    html = html.replace('<!-- PROFILE IMAGE -->', buildProfileImageHtml(content, headshot));

    // Social Icons
    const githubUrl = normalizeExternalUrl(content.socials?.github);
    const twitterUrl = normalizeExternalUrl(content.socials?.twitter);
    const socialIconsHtml = `
        ${linkedinUrl ? `<a href="${escapeAttr(linkedinUrl)}" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><span aria-hidden="true">in</span></a>` : ''}
        ${githubUrl ? `<a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><span aria-hidden="true">GH</span></a>` : ''}
        ${twitterUrl ? `<a href="${escapeAttr(twitterUrl)}" target="_blank" rel="noopener noreferrer" aria-label="X / Twitter"><span aria-hidden="true">X</span></a>` : ''}
    `;
    html = html.replace('<!-- SOCIAL ICONS - HERO -->', socialIconsHtml);
    html = html.replace('<!-- SOCIAL ICONS - FOOTER -->', socialIconsHtml);

    // Skills
    const skillsHtml = content.skills.map(skill => `
        <div class="skill">
            <span class="skill-icon" aria-hidden="true">${escapeHtml(buildSkillInitials(skill.category))}</span>
            <h3>${escapeHtml(skill.category)}</h3>
            <p>${escapeHtml(skill.description)}</p>
        </div>`).join('');
    html = html.replace('<!-- SKILLS -->', skillsHtml);

    // Experience
    const experienceHtml = content.experience.map(exp => `
        <div class="timeline-item">
            <div class="timeline-content">
                <div class="timeline-date">${escapeHtml(exp.date)}</div>
                <h3>${escapeHtml(exp.title)}</h3>
                <p>${escapeHtml(exp.company)}</p>
                <p>${escapeHtml(exp.description)}</p>
            </div>
        </div>`).join('');
    html = html.replace('<!-- EXPERIENCE -->', experienceHtml);

    // Projects
    const projectsHtml = projects.map(p => {
        const projectMediaHtml = buildProjectMediaHtml(p);
        const categorySlug = escapeAttr(p.category?.toLowerCase().trim().replace(/\s+/g, '-')) || 'web';
        const projectUrl = normalizeExternalUrl(p.url);
        const projectHref = projectUrl || '#portfolio';
        const projectTarget = projectUrl ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `
            <div class="portfolio-item" data-category="${categorySlug}">
                <a href="${escapeAttr(projectHref)}"${projectTarget} class="portfolio-overlay">
                    <h3>${escapeHtml(p.title)}</h3>
                    <p>${escapeHtml(truncate(p.description, 140))}</p>
                </a>
                ${projectMediaHtml}
            </div>`;
    }).join('');
    html = html.replace('<!-- PORTFOLIO ITEMS -->', projectsHtml);
    
    // Dynamic Filter Buttons
    const categories = [...new Set(projects.map(p => p.category).filter(Boolean))];
    const filterButtonsHtml = `
        <button type="button" class="filter-btn active" data-filter="all" aria-pressed="true">All</button>
        ${categories.map(cat => {
            const catSlug = escapeAttr(cat.toLowerCase().trim().replace(/\s+/g, '-'));
            return `<button type="button" class="filter-btn" data-filter="${catSlug}" aria-pressed="false">${escapeHtml(cat)}</button>`;
        }).join('')}
    `;
    html = html.replace(/<div class="portfolio-filter">[\s\S]*?<\/div>/, `<div class="portfolio-filter">${filterButtonsHtml}</div>`);

    return html;
};

interface PortfolioWebsiteBuilderProps {
  resumeText: string;
  initialInput?: string;
  profile?: UserProfile | null;
  session?: Session | null;
  t: (key: string) => string;
  onSavedPortfolio?: () => void;
  onUnsavedPortfolioChange?: (hasUnsaved: boolean) => void;
}

const PortfolioWebsiteBuilder: React.FC<PortfolioWebsiteBuilderProps> = ({ resumeText, initialInput, profile, session, t, onSavedPortfolio, onUnsavedPortfolioChange }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const formId = useId();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortfolioWebsiteResult | null>(null);
  const [portfolioContent, setPortfolioContent] = useState<PortfolioContent | null>(null);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [portfolioName, setPortfolioName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  const [currentStep, setCurrentStep] = useState<'template' | 'details' | 'result'>('template');
  const [details, setDetails] = useState({ tagline: '', bio: '', theme: 'sapphire' });
  const [projects, setProjects] = useState<Project[]>([DEFAULT_PROJECT]);
  const [importedProjectNotice, setImportedProjectNotice] = useState<string | null>(null);
  const [clearDraftConfirmOpen, setClearDraftConfirmOpen] = useState(false);
  const [projectRemoveTarget, setProjectRemoveTarget] = useState<Project | null>(null);
  
  const [headshotStep, setHeadshotStep] = useState<'initial' | 'camera' | 'photo_uploaded' | 'generating' | 'generated' | 'final_selected'>('initial');
  // Headshot failures get their own state so the message shows next to the
  // headshot card instead of at the bottom of the long details form.
  const [headshotError, setHeadshotError] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<HeadshotImage | null>(null);
  const [generatedImages, setGeneratedImages] = useState<HeadshotImage[]>([]);
  const [selectedHeadshot, setSelectedHeadshot] = useState<HeadshotImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const autoFillRunRef = useRef(0);
  const headshotRunRef = useRef(0);
  const imageUploadRunRef = useRef(0);
  const projectImageRunRef = useRef<Record<number, number>>({});
  const autoFillInFlightRef = useRef(false);
  const headshotGeneratingRef = useRef(false);
  const savePortfolioRef = useRef(false);
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef('');
  const consumedInitialInputRef = useRef<string | null>(null);
  const resumeFingerprint = useMemo(() => portfolioDraftResumeFingerprint(resumeText), [resumeText]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      autoFillRunRef.current++;
      headshotRunRef.current++;
      autoFillInFlightRef.current = false;
      headshotGeneratingRef.current = false;
      savePortfolioRef.current = false;
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setPortfolioContent(null);
    setDetails(prev => ({ tagline: '', bio: '', theme: prev.theme }));
    setProjects([DEFAULT_PROJECT]);
    setResult(null);
    setPortfolioName('');
    setSaveStatus('idle');
    setImportedProjectNotice(null);
    savePortfolioRef.current = false;
    consumedInitialInputRef.current = null;
    onUnsavedPortfolioChange?.(false);
    setCurrentStep('template');
    setDraftHydrated(false);
    lastSavedDraftRef.current = '';
  }, [onUnsavedPortfolioChange, resumeFingerprint]);

  useEffect(() => {
    let cancelled = false;
    const uid = session?.user?.id;

    if (!uid || !resumeText.trim()) {
      setDraftHydrated(true);
      setDraftStatus('idle');
      return () => {
        cancelled = true;
      };
    }

    setDraftStatus('loading');
    loadPortfolioDraft(uid)
      .then((draft) => {
        if (cancelled) return;

        if (draft && draft.resume_fingerprint === resumeFingerprint) {
          setPortfolioContent(draft.content);
          setDetails(draft.details);
          setProjects(draft.projects.length > 0 ? draft.projects.map(fromDraftProject) : [DEFAULT_PROJECT]);
          lastSavedDraftRef.current = serializeDraftSnapshot({
            resume_fingerprint: draft.resume_fingerprint,
            content: draft.content,
            details: draft.details,
            projects: draft.projects,
          });
          setDraftStatus('saved');
        } else {
          setDraftStatus('idle');
        }
      })
      .catch(() => {
        if (!cancelled) setDraftStatus('error');
      })
      .finally(() => {
        if (!cancelled) setDraftHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [resumeFingerprint, resumeText, session?.user?.id]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!draftHydrated || !uid || !resumeText.trim()) return undefined;

    const draft = buildDraftSnapshot(resumeFingerprint, portfolioContent, details, projects);
    if (!isMeaningfulDraft(draft)) return undefined;

    const serializedDraft = serializeDraftSnapshot(draft);
    if (serializedDraft === lastSavedDraftRef.current) return undefined;

    if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    setDraftStatus('saving');
    let cancelled = false;
    saveDraftTimerRef.current = setTimeout(() => {
      savePortfolioDraft(uid, draft)
        .then(() => {
          if (cancelled || !mountedRef.current) return;
          lastSavedDraftRef.current = serializedDraft;
          setDraftStatus('saved');
        })
        .catch(() => {
          if (!cancelled && mountedRef.current) setDraftStatus('error');
        });
    }, 900);

    return () => {
      cancelled = true;
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    };
  }, [details, draftHydrated, portfolioContent, projects, resumeFingerprint, resumeText, session?.user?.id]);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    if (headshotStep === 'camera' && cameraStream && videoRef.current) {
        videoRef.current.srcObject = cameraStream;
        videoRef.current.play();
    }
  }, [headshotStep, cameraStream]);

  useEffect(() => {
    if (!initialInput || !draftHydrated || consumedInitialInputRef.current === initialInput) return;

    try {
      const project: SkillBridgeProject = JSON.parse(initialInput);
      const projectTitle = project.projectTitle?.trim();
      const projectObjective = project.objective?.trim();
      if (!projectTitle || !projectObjective) return;

      consumedInitialInputRef.current = initialInput;
      setProjects(prev => {
        if (prev.length === 1 && !prev[0].title.trim() && !prev[0].description.trim()) {
          return [{ ...prev[0], title: projectTitle, description: projectObjective, category: prev[0].category || 'Web' }];
        }
        return [...prev, { id: createProjectId(), title: projectTitle, description: projectObjective, url: '', category: 'Web' }];
      });
      setImportedProjectNotice(projectTitle);
      setError(null);
      setCurrentStep('details');
    } catch (e) {
      console.error("Could not parse initial project for portfolio builder", e);
    }
  }, [draftHydrated, initialInput]);

  const { addToast } = useToast();

  const runTool = async () => {
    if (loading) return; // guard re-entry: a paid generate must not double-fire
    if (!details.tagline || !details.bio) {
      setError(t('tool_portfolio_error_required'));
      return;
    }
    if (!portfolioContent && !resumeText.trim()) {
      setError(t('tool_portfolio_auto_fill_no_resume'));
      return;
    }
    const alive = begin();
    setError(null);
    const resumeSnapshot = resumeText;
    try {
      const extractedContent = portfolioContent ?? await generatePortfolioWebsite(resumeSnapshot);

      // Drop a result whose resume changed mid-flight (stale-resume guard).
      if (!alive() || resumeSnapshot !== resumeText) return;
      setPortfolioContent(extractedContent);

      const finalHtml = buildHtml({
        content: extractedContent,
        branding: details,
        projects: projects,
        headshot: selectedHeadshot
      });

      setResult({ htmlContent: finalHtml });
      setPreviewTheme(details.theme);
      setCurrentStep('result');
      setPortfolioName(defaultPortfolioName());
      setSaveStatus('idle');
      onUnsavedPortfolioChange?.(true);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error'));
    } finally {
      if (alive()) end();
    }
  };

  const handleAutoFillFromResume = async () => {
    if (!resumeText.trim()) {
      setError(t('tool_portfolio_auto_fill_no_resume'));
      return;
    }
    if (autoFillInFlightRef.current) return;
    autoFillInFlightRef.current = true;
    const runId = ++autoFillRunRef.current;
    // Snapshot the resume this run is for: if the resume changes mid-flight, the
    // cache-clearing effect fires but the run-id guard alone wouldn't catch it,
    // so a stale result could repopulate the cache. Drop the run if it diverged.
    const resumeSnapshot = resumeText;
    setAutoFillLoading(true);
    setError(null);
    try {
      const extractedContent = await generatePortfolioWebsite(resumeSnapshot);
      if (!mountedRef.current || autoFillRunRef.current !== runId || resumeSnapshot !== resumeText) return;

      setPortfolioContent(extractedContent);
      setDetails(prev => ({
        ...prev,
        tagline: buildTaglineFromContent(extractedContent),
        bio: buildBioFromContent(extractedContent),
      }));
      setProjects(prev => {
        const canReplace = prev.length === 0 || prev.every(isBlankProject);
        return canReplace ? buildProjectsFromContent(extractedContent) : prev;
      });
      addToast(t('tool_portfolio_auto_fill_success'), 'success');
    } catch (err) {
      if (mountedRef.current && autoFillRunRef.current === runId) {
        setError(err instanceof Error ? err.message : t('tool_portfolio_auto_fill_error'));
      }
    } finally {
      if (autoFillRunRef.current === runId) autoFillInFlightRef.current = false;
      if (mountedRef.current && autoFillRunRef.current === runId) setAutoFillLoading(false);
    }
  };

  // Bumped on each generate/cancel so a late (or cancelled) result is ignored —
  // the user can never be trapped on the "Generating…" spinner.
  const handleGenerateHeadshots = async () => {
    if (!uploadedImage) {
      setHeadshotError(t('tool_portfolio_photo_required'));
      return;
    }
    if (headshotGeneratingRef.current) return;
    headshotGeneratingRef.current = true;
    const runId = ++headshotRunRef.current;
    setHeadshotStep('generating');
    setHeadshotError(null);
    try {
        // Client watchdog: even if the call hangs, resolve to a retryable error.
        const results = await Promise.race([
            generateProfessionalHeadshot(uploadedImage.data),
            new Promise<HeadshotImage[]>((_, reject) =>
                setTimeout(() => reject(new Error(t('tool_portfolio_headshot_timeout'))), 120_000)),
        ]);
        if (!mountedRef.current || headshotRunRef.current !== runId) return; // cancelled / superseded
        if (!Array.isArray(results) || results.length === 0) {
          setHeadshotError(t('tool_portfolio_headshot_empty'));
          setHeadshotStep('photo_uploaded');
          return;
        }
        setGeneratedImages(results);
        setHeadshotStep('generated');
    } catch (err) {
        if (!mountedRef.current || headshotRunRef.current !== runId) return;
        setHeadshotError(err instanceof Error ? err.message : t('tool_portfolio_headshot_failed'));
        setHeadshotStep('photo_uploaded');
    } finally {
        if (headshotRunRef.current === runId) headshotGeneratingRef.current = false;
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const runId = ++imageUploadRunRef.current;
    try {
        const resizedImage = await resizeImage(file, 800);
        if (!mountedRef.current || imageUploadRunRef.current !== runId) return;
        setUploadedImage(resizedImage);
        setHeadshotStep('photo_uploaded');
        setHeadshotError(null);
    } catch (err) {
        setHeadshotError(t('tool_portfolio_image_process_failed'));
        console.error(err);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      setCameraStream(stream);
      setHeadshotStep('camera');
      setHeadshotError(null);
    } catch (err) {
      console.error("Camera Error:", err);
      setHeadshotError(t('tool_portfolio_camera_access_failed'));
    }
  };

  const stopCameraStream = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const maxSize = 800;
      let { videoWidth: width, videoHeight: height } = video;

      if (width > height) {
          if (width > maxSize) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
          }
      } else {
          if (height > maxSize) {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
          }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, width, height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const base64String = dataUrl.split(',')[1];
      if (base64String) {
        setUploadedImage({ mimeType: 'image/jpeg', data: base64String });
      }
      setHeadshotStep('photo_uploaded');
      stopCameraStream();
    }
  };

  const resetHeadshotFlow = () => {
    imageUploadRunRef.current++;
    headshotRunRef.current++;
    setHeadshotStep('initial');
    setHeadshotError(null);
    setUploadedImage(null);
    setGeneratedImages([]);
    setSelectedHeadshot(null);
    stopCameraStream();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runTool();
  };
  
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const isChineseUi = t('ws_nav_resume') === '简历';
  const stripStepNumber = (value: string) => value.replace(/^\s*\d+\.\s*/, '');
  const checklistCopyLabel = stripStepNumber(t('tool_portfolio_step1_title'));
  const checklistItemsLabel = stripStepNumber(t('tool_portfolio_step3_title'));
  const checklistLabels = {
    title: isChineseUi ? '发布检查' : 'Build checklist',
    resume: t('ws_nav_resume'),
    ready: t('dashboard_priority_status_ready'),
    missing: isChineseUi ? '缺少' : 'Missing',
    copy: checklistCopyLabel,
    reviewed: isChineseUi ? '已检查' : 'Reviewed',
    needsReview: t('applicant_funnel_needs_review_chip'),
    items: checklistItemsLabel,
    selected: isChineseUi ? '个已选择' : 'selected',
    theme: isChineseUi ? '风格' : 'Theme',
  };
  const resultLabels = {
    backToDetails: isChineseUi ? '返回编辑' : 'Back to details',
    nextActions: isChineseUi ? '下一步操作' : 'Next actions',
    generated: isChineseUi ? '作品集已生成' : 'Showcase generated',
    generatedHint: isChineseUi
      ? '先检查预览，再下载 HTML 文件，最后按发布步骤上线。'
      : 'Review the preview, download the HTML file, then follow the publish steps.',
    reviewTitle: isChineseUi ? '检查预览' : 'Review preview',
    reviewDesc: isChineseUi ? '确认头像、项目和移动端布局。' : 'Check the headshot, projects, and mobile layout.',
    downloadTitle: isChineseUi ? '下载文件' : 'Download file',
    downloadDesc: isChineseUi ? '保存可直接发布的 showcase.html。' : 'Save the deployable showcase.html file.',
    deployTitle: t('tool_portfolio_tab_deploy'),
    deployDesc: isChineseUi ? '打开发布说明和外部发布入口。' : 'Open the publishing steps and external deploy links.',
    codeTitle: t('tool_portfolio_tab_code'),
    codeDesc: isChineseUi ? '复制源码给开发者或托管平台。' : 'Copy the source for a developer or hosting platform.',
    emptyTitle: isChineseUi ? '没有可预览的内容' : 'No preview content',
    emptyDesc: isChineseUi ? '返回编辑页重新生成作品集。' : 'Return to details and generate the showcase again.',
    deployChecklist: isChineseUi ? '发布检查清单' : 'Publish checklist',
    openNetlify: isChineseUi ? '打开 Netlify Drop' : 'Open Netlify Drop',
    openLab: t('tool_portfolio_deploy_open_lab_button'),
    codeHint: isChineseUi
      ? '如果要交给开发者、Vercel、Netlify 或自有服务器，可以复制这一份完整 HTML。'
      : 'Use this full HTML file for a developer, Vercel, Netlify, or your own hosting.',
  };

  const handleDetailChange = (field: keyof typeof details, value: string) => setDetails(prev => ({ ...prev, [field]: value }));
  const handleProjectChange = (id: number, field: string, value: string) => setProjects(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  const addProject = () => setProjects(prev => [...prev, { id: createProjectId(), title: '', description: '', url: '', category: 'Web' }]);
  const removeProject = (id: number) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setProjectRemoveTarget(null);
  };

  const clearSavedDraft = async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    try {
      await deletePortfolioDraft(uid);
      if (!mountedRef.current) return;
      lastSavedDraftRef.current = '';
      setPortfolioContent(null);
      setDetails(prev => ({ tagline: '', bio: '', theme: prev.theme }));
      setProjects([DEFAULT_PROJECT]);
      setResult(null);
      setCurrentStep('template');
      setDraftStatus('idle');
      setClearDraftConfirmOpen(false);
      addToast(t('tool_portfolio_draft_cleared'), 'success');
    } catch (err) {
      if (!mountedRef.current) return;
      setDraftStatus('error');
      setError(err instanceof Error ? err.message : t('tool_portfolio_draft_save_failed'));
    }
  };

  const handleSavePortfolio = async () => {
    const uid = session?.user?.id;
    if (!uid || !result || saveStatus === 'saving' || savePortfolioRef.current) return;
    savePortfolioRef.current = true;
    setSaveStatus('saving');
    try {
      const theme = previewTheme || details.theme;
      await savePortfolio(uid, {
        name: portfolioName,
        theme,
        htmlContent: applyPortfolioTheme(result.htmlContent, theme),
        resumeFingerprint,
      });
      if (!mountedRef.current) return;
      setSaveStatus('saved');
      onUnsavedPortfolioChange?.(false);
      onSavedPortfolio?.();
      addToast(t('showcase_save_success'), 'success');
    } catch (err) {
      if (!mountedRef.current) return;
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : t('showcase_save_failed'));
    } finally {
      savePortfolioRef.current = false;
    }
  };

  const discardGeneratedPortfolio = () => {
    setResult(null);
    setCurrentStep('details');
    setSaveStatus('idle');
    setPortfolioName('');
    onUnsavedPortfolioChange?.(false);
  };
  
  const handleProjectImageUpload = async (id: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const runId = (projectImageRunRef.current[id] ?? 0) + 1;
    projectImageRunRef.current[id] = runId;
    try {
        const resizedImage = await resizeImage(file, 600);
        if (!mountedRef.current || projectImageRunRef.current[id] !== runId) return;
        setProjects(prev => prev.map(p => p.id === id ? { ...p, image: resizedImage } : p));
    } catch (err) {
        setError(t('tool_portfolio_image_process_failed'));
        console.error(err);
    }
  };
  
  const renderTemplateSelection = () => (
    <div data-qa="portfolio-builder-tool" data-qa-tool-state="template" className="space-y-8 animate-fade-in py-4">
        <div className="text-center">
            <h3 className="text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{t('tool_portfolio_choose_style_title')}</h3>
            <p className="text-gray-600 dark:text-gray-400 mt-2">{t('tool_portfolio_choose_style_subtitle')}</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {PORTFOLIO_TEMPLATES.map(t_template => (
                <button type="button"
                    key={t_template.key} 
                    data-qa={`portfolio-template-${t_template.key}`}
                    onClick={() => {
                        handleDetailChange('theme', t_template.key);
                        setCurrentStep('details');
                    }}
                    className={`group relative text-left p-6 bg-white dark:bg-slate-800 border-2 rounded-2xl transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${details.theme === t_template.key ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-lg shadow-blue-500/10' : 'border-gray-200 dark:border-slate-700'}`}
                >
                    <div className="flex items-center justify-between mb-4">
                        <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                             <div className="flex -space-x-1">
                                {t_template.colors.map(c => <div key={c} className="h-4 w-4 rounded-full border-2 border-white dark:border-slate-800 shadow-sm" style={{ backgroundColor: c }}></div>)}
                             </div>
                        </div>
                        {details.theme === t_template.key && (
                            <div className="bg-blue-600 text-white p-1 rounded-full shadow-md">
                                <Check className="h-4 w-4" aria-hidden="true" />
                            </div>
                        )}
                    </div>
                    
                    <h4 className="font-bold text-xl text-gray-900 dark:text-gray-100 mb-1">{t_template.name}</h4>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{t_template.description}</p>
                    
                    <div className="mt-auto flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-sm group-hover:translate-x-1 transition-transform">
                        <span>{t('tool_portfolio_select_template')}</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </div>
                </button>
            ))}
        </div>
    </div>
  );
  
  const renderHeadshotGenerator = () => {
    switch (headshotStep) {
        case 'initial':
            return (
                <div className="p-4 bg-white dark:bg-slate-800 rounded-md border dark:border-slate-700 text-center">
                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    <p className="text-gray-600 dark:text-gray-400 mb-3 text-sm">{t('tool_portfolio_headshot_desc')}</p>
                    <div className="flex justify-center gap-4">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-slate-600 font-semibold">{t('tool_portfolio_upload_button')}</button>
                        <button type="button" onClick={startCamera} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-slate-600 font-semibold">{t('tool_portfolio_camera_button')}</button>
                    </div>
                </div>
            );
        case 'camera':
            return (
                <div className="p-4 bg-black rounded-md border border-gray-800 text-center">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-md" />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="flex justify-center gap-4 mt-3">
                        <button type="button" onClick={handleCapture} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">{t('tool_portfolio_capture_button')}</button>
                        <button type="button" onClick={() => { stopCameraStream(); setHeadshotStep('initial'); }} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">{t('tool_portfolio_cancel_button')}</button>
                    </div>
                </div>
            );
        case 'photo_uploaded':
            if (!uploadedImage) return null;
            return (
                <div className="p-4 bg-white dark:bg-slate-800 rounded-md border dark:border-slate-700 text-center">
                    <img src={`data:${uploadedImage.mimeType};base64,${uploadedImage.data}`} alt="Uploaded headshot" className="w-40 h-40 object-cover rounded-full mx-auto shadow-lg border-4 border-gray-200 dark:border-slate-700 p-1" />
                    <div className="flex flex-col sm:flex-row justify-center gap-3 mt-4">
                        <button type="button" onClick={handleGenerateHeadshots} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold">{t('tool_portfolio_generate_avatars_button')}</button>
                        <button type="button" onClick={() => { setSelectedHeadshot(uploadedImage); setHeadshotStep('final_selected'); }} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-semibold">{t('tool_portfolio_use_photo_button')}</button>
                    </div>
                     <button type="button" onClick={resetHeadshotFlow} className="mt-3 text-sm text-gray-600 dark:text-slate-400 hover:underline">{t('tool_portfolio_change_photo_button')}</button>
                </div>
            );
        case 'generating':
             return (
                 <div className="text-center p-8">
                    <p className="text-xl text-gray-800 dark:text-gray-100 font-semibold mb-2">{t('tool_portfolio_generating_avatars_message') || 'Generating...'}</p>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{t('tool_portfolio_generating_avatars_hint')}</p>
                    <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-700 rounded-full animate-spin mx-auto"></div>
                    <button type="button" onClick={() => { headshotRunRef.current++; headshotGeneratingRef.current = false; setHeadshotStep('photo_uploaded'); }} className="mt-6 text-sm text-gray-600 dark:text-slate-400 hover:underline">{t('tool_portfolio_cancel')}</button>
                 </div>
             );
        case 'generated':
            return (
                <div className="p-4 bg-white dark:bg-slate-800 rounded-md border dark:border-slate-700 text-center">
                    <p className="font-semibold mb-3 dark:text-gray-100">{t('tool_portfolio_choose_avatar_title')}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {generatedImages.map((img, i) => (
                            <button type="button" key={i} onClick={() => { setSelectedHeadshot(img); setHeadshotStep('final_selected'); }} className="border-2 border-transparent hover:border-blue-500 rounded-lg p-1 transition-all">
                                <img src={`data:${img.mimeType};base64,${img.data}`} alt={`Generated avatar ${i + 1}`} className="w-full h-auto object-cover rounded-md" />
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={() => setHeadshotStep('photo_uploaded')} className="mt-3 text-sm text-gray-600 dark:text-slate-400 hover:underline">{t('tool_portfolio_try_again_button')}</button>
                </div>
            );
        case 'final_selected':
            if (!selectedHeadshot) return null;
            return (
                <div className="p-4 bg-white dark:bg-slate-800 rounded-md border dark:border-slate-700 text-center">
                    <p className="font-semibold mb-2 dark:text-gray-100">{t('tool_portfolio_selected_headshot_title')}</p>
                    <img src={`data:${selectedHeadshot.mimeType};base64,${selectedHeadshot.data}`} alt="Selected headshot" className="w-40 h-40 object-cover rounded-full mx-auto shadow-lg border-4 border-blue-500 p-1" />
                    <button type="button" onClick={() => { setGeneratedImages([]); setHeadshotStep('photo_uploaded'); }} className="mt-4 text-sm text-gray-600 dark:text-slate-400 hover:underline">{t('tool_portfolio_change_selection_button')}</button>
                </div>
            );
    }
  };


  const renderInput = () => {
    if (loading) return (
      <StagedLoader
        icon={<Globe />}
        accent="pink"
        title={t('tool_portfolio_building_title')}
        steps={[
          t('tool_portfolio_building_step1'),
          t('tool_portfolio_building_step2'),
          t('tool_portfolio_building_step3'),
          t('tool_portfolio_building_step4'),
        ]}
        onCancel={cancel}
      />
    );
    return (
    <div data-qa="portfolio-builder-tool" data-qa-tool-state="details" className="max-w-6xl mx-auto space-y-10 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
            <button type="button"
                onClick={() => setCurrentStep('template')}
                className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t('tool_portfolio_back_to_styles')}
            </button>
            <div className="flex flex-wrap justify-end gap-2">
                {draftStatus !== 'idle' && (
                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
                        draftStatus === 'error'
                            ? 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50'
                    }`}>
                        {draftStatus === 'loading' && t('tool_portfolio_draft_status_loading')}
                        {draftStatus === 'saving' && t('tool_portfolio_draft_status_saving')}
                        {draftStatus === 'saved' && t('tool_portfolio_draft_status_saved')}
                        {draftStatus === 'error' && t('tool_portfolio_draft_save_failed')}
                    </div>
                )}
                {session?.user?.id && (
                    <button
                        type="button"
                        onClick={() => setClearDraftConfirmOpen(true)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        {t('tool_portfolio_clear_draft_button')}
                    </button>
                )}
                <div className="px-4 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-full text-xs font-bold border border-blue-100 dark:border-blue-800/50">
                    {checklistLabels.theme}: {PORTFOLIO_TEMPLATES.find(t => t.key === details.theme)?.name}
                </div>
            </div>
        </div>

        {importedProjectNotice && (
          <div
            data-qa="portfolio-builder-imported-project-notice"
            role="status"
            className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-bold">{isChineseUi ? '已从职业路径导入项目' : 'Project imported from Career Path'}</p>
                <p className="mt-1 truncate text-emerald-800 dark:text-emerald-200">{importedProjectNotice}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setImportedProjectNotice(null)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-md text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40 sm:self-auto"
              aria-label={isChineseUi ? '关闭导入提示' : 'Dismiss imported project notice'}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <div className="min-w-0 space-y-8">
            <div>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 className="font-bold text-xl text-gray-900 dark:text-gray-100">{t('tool_portfolio_step1_title')}</h4>
                        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{t('tool_portfolio_auto_fill_note')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleAutoFillFromResume}
                        disabled={autoFillLoading || loading || !resumeText.trim()}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                    >
                        {autoFillLoading ? (
                            <span className="h-4 w-4 rounded-full border-2 border-blue-200 border-t-blue-700 animate-spin dark:border-blue-900 dark:border-t-blue-300" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}
                        <span>{autoFillLoading ? t('tool_portfolio_auto_fill_loading') : t('tool_portfolio_auto_fill_button')}</span>
                    </button>
                </div>
                <div className="space-y-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm">
                    <div>
                        <label htmlFor={`${formId}-tagline`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_tagline_label')}</label>
                        <input data-qa="portfolio-tagline" id={`${formId}-tagline`} type="text" value={details.tagline} onChange={e => handleDetailChange('tagline', e.target.value)} placeholder={t('tool_portfolio_tagline_placeholder')} required className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                        <label htmlFor={`${formId}-bio`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_bio_label')}</label>
                        <textarea data-qa="portfolio-bio" id={`${formId}-bio`} value={details.bio} onChange={e => handleDetailChange('bio', e.target.value)} rows={3} placeholder={t('tool_portfolio_bio_placeholder')} required className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                    </div>
                </div>
            </div>

            <div>
                <h4 className="font-bold text-xl text-gray-900 dark:text-gray-100 mb-4">{t('tool_portfolio_step2_title')}</h4>
                <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm">
                    {headshotError && (
                        <div className="mb-4">
                            <ToolError message={headshotError} />
                        </div>
                    )}
                    {renderHeadshotGenerator()}
                </div>
            </div>

            <div>
                <h4 className="font-bold text-xl text-gray-900 dark:text-gray-100 mb-4">{t('tool_portfolio_step3_title')}</h4>
                <div className="space-y-4">
                    {projects.map((p, index) => (
                        <div key={p.id} className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm relative group overflow-hidden">
                            {projects.length > 1 && (
                                <button type="button" aria-label={isChineseUi ? `移除 ${p.title || '项目'}` : `Remove ${p.title || 'project'}`} onClick={() => setProjectRemoveTarget(p)} className="absolute top-4 right-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full h-8 w-8 flex items-center justify-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                                    <X className="h-5 w-5" aria-hidden="true" />
                                </button>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor={`${formId}-project-title-${p.id}`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_project_title_label')}</label>
                                    <input data-qa={`portfolio-project-title-${index}`} id={`${formId}-project-title-${p.id}`} type="text" value={p.title} onChange={e => handleProjectChange(p.id, 'title', e.target.value)} required className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor={`${formId}-project-url-${p.id}`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_project_url_label')}</label>
                                    <input id={`${formId}-project-url-${p.id}`} type="url" value={p.url} onChange={e => handleProjectChange(p.id, 'url', e.target.value)} placeholder={t('tool_portfolio_project_url_placeholder')} className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                                    <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{t('tool_portfolio_project_url_hint')}</p>
                                </div>
                            </div>
                            <div className="mt-6">
                                <label htmlFor={`${formId}-project-category-${p.id}`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_project_category_label')}</label>
                                    <input data-qa={`portfolio-project-category-${index}`} id={`${formId}-project-category-${p.id}`} type="text" value={p.category} onChange={e => handleProjectChange(p.id, 'category', e.target.value)} required placeholder={t('tool_portfolio_project_category_placeholder')} className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                            </div>
                            <div className="mt-6">
                                <label htmlFor={`${formId}-project-description-${p.id}`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_project_desc_label')}</label>
                                <textarea data-qa={`portfolio-project-description-${index}`} id={`${formId}-project-description-${p.id}`} value={p.description} onChange={e => handleProjectChange(p.id, 'description', e.target.value)} rows={2} required className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white" />
                            </div>
                            <div className="mt-6">
                                <label htmlFor={`${formId}-project-image-${p.id}`} className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">{t('tool_portfolio_project_image_label')}</label>
                                <input id={`${formId}-project-image-${p.id}`} type="file" accept="image/*" onChange={e => handleProjectImageUpload(p.id, e)} className="mt-1 block w-full text-xs text-gray-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-blue-50 dark:file:bg-blue-900/20 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30"/>
                            </div>
                        </div>
                    ))}
                    <button type="button" onClick={addProject} className="w-full py-4 px-4 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 font-bold transition-colors">
                        {t('tool_portfolio_add_project_button')}
                    </button>
                </div>
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">{checklistLabels.title}</p>
                <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-700 dark:text-slate-300">{checklistLabels.resume}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${resumeText.trim() ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                            {resumeText.trim() ? checklistLabels.ready : checklistLabels.missing}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-700 dark:text-slate-300">{checklistLabels.copy}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${details.tagline && details.bio ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                            {details.tagline && details.bio ? checklistLabels.reviewed : checklistLabels.needsReview}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-700 dark:text-slate-300">{checklistLabels.items}</span>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                            {isChineseUi
                                ? `${projects.filter(project => !isBlankProject(project)).length}${checklistLabels.selected}`
                                : `${projects.filter(project => !isBlankProject(project)).length} ${checklistLabels.selected}`}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-700 dark:text-slate-300">{checklistLabels.theme}</span>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                            {PORTFOLIO_TEMPLATES.find(t_template => t_template.key === details.theme)?.name}
                        </span>
                    </div>
                </div>
            </div>

            {error && <ToolError message={error} />}

            <button data-qa="portfolio-generate" type="submit" disabled={loading || autoFillLoading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-4 px-4 rounded-2xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transform active:scale-[0.98] transition-all">
                <>
                    <Code2 className="h-5 w-5" aria-hidden="true" />
                    <span>{t('tool_portfolio_generate_button')}</span>
                </>
            </button>
          </aside>
        </form>
        <ConfirmActionDialog
          open={clearDraftConfirmOpen}
          title={t('tool_portfolio_clear_draft_button')}
          description={isChineseUi ? '清除已保存的作品集草稿，并重置当前编辑内容？' : 'Clear the saved portfolio draft and reset the current editor content?'}
          cancelLabel={isChineseUi ? '取消' : 'Cancel'}
          confirmLabel={t('tool_portfolio_clear_draft_button')}
          loadingLabel={t('tool_portfolio_draft_status_saving')}
          tone="danger"
          onOpenChange={(open) => {
            if (!open) setClearDraftConfirmOpen(false);
          }}
          onCancel={() => setClearDraftConfirmOpen(false)}
          onConfirm={() => void clearSavedDraft()}
        />
        <ConfirmActionDialog
          open={Boolean(projectRemoveTarget)}
          title={isChineseUi ? '移除项目' : 'Remove project'}
          description={isChineseUi ? '从作品集草稿中移除这个项目？' : 'Remove this project from the portfolio draft?'}
          detail={projectRemoveTarget?.title || projectRemoveTarget?.category}
          cancelLabel={isChineseUi ? '取消' : 'Cancel'}
          confirmLabel={isChineseUi ? '移除项目' : 'Remove project'}
          tone="danger"
          onOpenChange={(open) => {
            if (!open) setProjectRemoveTarget(null);
          }}
          onCancel={() => setProjectRemoveTarget(null)}
          onConfirm={() => {
            if (projectRemoveTarget) removeProject(projectRemoveTarget.id);
          }}
        />
    </div>
    );
  };

  const mainViewRenderer = () => {
      if (currentStep === 'result') return renderResult();
      if (currentStep === 'template') return renderTemplateSelection();
      return renderInput();
  }

  const getModifiedHtmlContent = (originalHtml: string, themeKey: string | null): string => {
    return applyPortfolioTheme(originalHtml, themeKey);
  };

  const renderResult = () => {
    if (error) return <ToolError message={error} onRetry={() => { setError(null); setCurrentStep('details'); }} retryLabel={resultLabels.backToDetails} />;
    if (!result || !previewTheme) {
      return (
        <ToolError
          message={`${resultLabels.emptyTitle}. ${resultLabels.emptyDesc}`}
          onRetry={() => setCurrentStep('details')}
          retryLabel={resultLabels.backToDetails}
        />
      );
    }
    
    const { htmlContent } = result;
    const themedHtmlContent = getModifiedHtmlContent(htmlContent, previewTheme);
    if (!themedHtmlContent.trim()) {
      return (
        <ToolError
          message={`${resultLabels.emptyTitle}. ${resultLabels.emptyDesc}`}
          onRetry={() => setCurrentStep('details')}
          retryLabel={resultLabels.backToDetails}
        />
      );
    }
    const completedProjectCount = projects.filter(project => !isBlankProject(project)).length;
    const themeName = PORTFOLIO_TEMPLATES.find(t_template => t_template.key === previewTheme)?.name ?? previewTheme;
    const saveActions = (
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="block">
          <span className="text-sm font-bold text-gray-800 dark:text-slate-200">{t('showcase_save_name_label')}</span>
          <input
            data-qa="portfolio-save-name"
            type="text"
            value={portfolioName}
            onChange={(event) => {
              setPortfolioName(event.target.value);
              if (saveStatus === 'saved') setSaveStatus('idle');
            }}
            placeholder={defaultPortfolioName()}
            className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-950/50"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSavePortfolio}
            data-qa="portfolio-save"
            disabled={saveStatus === 'saving'}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveStatus === 'saving' ? t('showcase_saving') : t('showcase_save_button')}
          </button>
          <button
            type="button"
            onClick={discardGeneratedPortfolio}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('showcase_discard_button')}
          </button>
        </div>
        {saveStatus === 'saved' && <p data-qa="portfolio-save-status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t('showcase_saved_status')}</p>}
        {saveStatus === 'error' && <p data-qa="portfolio-save-status" className="text-sm font-semibold text-red-700 dark:text-red-300">{t('showcase_save_failed')}</p>}
      </div>
    );

    return (
      <div data-qa="portfolio-builder-tool" data-qa-tool-state="result">
        <PortfolioPreviewViewer
          htmlContent={htmlContent}
          theme={previewTheme}
          title={t('showcase_generated_title')}
          hint={t('showcase_generated_hint')}
          filename={portfolioName || 'showcase'}
          badges={[`${completedProjectCount} ${t('showcase_projects_selected')}`]}
          actionSlot={saveActions}
          onThemeChange={setPreviewTheme}
          showActionCards={false}
          showThemePicker={false}
          t={t}
        />
      </div>
    );

  };

  return mainViewRenderer();
};

export default PortfolioWebsiteBuilder;
