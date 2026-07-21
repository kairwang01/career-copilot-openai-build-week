
import React from 'react';
import {
    Award,
    BadgeCheck,
    BarChart3,
    BriefcaseBusiness,
    CalendarDays,
    ClipboardCheck,
    Code2,
    Download,
    GraduationCap,
    Languages,
    Mail,
    Mic,
    Network,
    PenLine,
    TrendingUp,
    Wallet,
} from 'lucide-react';

export const featureIcons = {
    opportunity: <BriefcaseBusiness className="h-5 w-5" />,
    interview: <Mic className="h-5 w-5" />,
    interviewPrep: <ClipboardCheck className="h-5 w-5" />,
    career: <TrendingUp className="h-5 w-5" />,
    website: <Code2 className="h-5 w-5" />,
    agile: <Award className="h-5 w-5" />,
    salary: <Wallet className="h-5 w-5" />,
    english: <Languages className="h-5 w-5" />,
    coverLetter: <PenLine className="h-5 w-5" />,
    email: <Mail className="h-5 w-5" />,
    linkedin: <BarChart3 className="h-5 w-5" />,
    formatter: <Download className="h-5 w-5" />,
    networking: <Network className="h-5 w-5" />,
    performanceReview: <BadgeCheck className="h-5 w-5" />,
    learningPlan: <GraduationCap className="h-5 w-5" />,
    eventScout: <CalendarDays className="h-5 w-5" />,
};

export const ALL_TOOLS_CONFIG: {
    key: string;
    icon: React.ReactElement<{ className?: string }>;
    darkBgColor: string;
    aiDependent?: boolean;
}[] = [
    { key: 'opportunity-finder', icon: featureIcons.opportunity, darkBgColor: 'bg-red-500' },
    { key: 'cover-letter', icon: featureIcons.coverLetter, darkBgColor: 'bg-yellow-500' },
    { key: 'interview-prep', icon: featureIcons.interviewPrep, darkBgColor: 'bg-teal-600' },
    { key: 'mock-interview', icon: featureIcons.interview, darkBgColor: 'bg-teal-500' },
    { key: 'resume-formatter', icon: featureIcons.formatter, darkBgColor: 'bg-green-500' },
    { key: 'career-path', icon: featureIcons.career, darkBgColor: 'bg-cyan-500' },
    { key: 'website-builder', icon: featureIcons.website, darkBgColor: 'bg-slate-500' },
    { key: 'skill-learning-plan', icon: featureIcons.learningPlan, darkBgColor: 'bg-violet-500' },
    { key: 'performance-review-prep', icon: featureIcons.performanceReview, darkBgColor: 'bg-amber-500' },
    { key: 'salary-negotiation', icon: featureIcons.salary, darkBgColor: 'bg-lime-500' },
    { key: 'linkedin-optimizer', icon: featureIcons.linkedin, darkBgColor: 'bg-indigo-500' },
    { key: 'networking-assistant', icon: featureIcons.networking, darkBgColor: 'bg-sky-500' },
    { key: 'industry-event-scout', icon: featureIcons.eventScout, darkBgColor: 'bg-fuchsia-500' },
    { key: 'email-crafter', icon: featureIcons.email, darkBgColor: 'bg-pink-500' },
    { key: 'english-pro', icon: featureIcons.english, darkBgColor: 'bg-rose-500' },
    { key: 'agile-coach', icon: featureIcons.agile, darkBgColor: 'bg-orange-500' },
];
